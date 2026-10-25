/**
 * Behaviour tests for the plugin_health_check tool.
 *
 * No DSH install, network or npm dependency is needed: `defineTool` is an
 * identity stub, `audit` is injected, and `src/index.js` is loaded with the
 * host module replaced by a stub through a Node resolve hook.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

import { FINDING_LIMIT, compactReport, formatSummary } from '../src/report.js';
import { DEFAULT_PROFILE, TOOL_NAME, createHealthCheckTool } from '../src/tool.js';

const defineTool = definition => definition;
const exec = { signal: new AbortController().signal };

function result(overrides = {}) {
  return {
    host: 'dsh',
    profile: 'web',
    root: '/home/u/.dsh/profiles/web',
    runtime_version: '0.2.1-rc.2',
    packages: [{ name: 'a', selected_as: 'a', version: '1.0.0', source: 'profile', path: '/x/a', compatibility: { status: 'compatible' } }],
    entries: [{ id: 'one', name: 'a', disabled: false, scope: 'profile', source: '/x/a/cordis.patch.yml' }],
    findings: [],
    fatal_count: 0,
    coverage: { selected_bundles: 1, resolved_bundles: 1, config_complete: true, runtime: 'not-inspected', limitations: [], not_checked: [] },
    status: 'pass',
    exit_code: 0,
    ...overrides,
  };
}

function tool(audit) {
  return createHealthCheckTool({ defineTool, audit });
}

test('the tool has a stable name, optional parameters and a read-only description', () => {
  const definition = tool(async () => result());
  assert.equal(definition.name, TOOL_NAME);
  assert.equal(TOOL_NAME, 'plugin_health_check');
  assert.deepEqual(Object.keys(definition.parameters).sort(), ['candidate', 'dshVersion', 'profile']);
  for (const parameter of Object.values(definition.parameters)) assert.notEqual(parameter.required, true);
  assert.match(definition.description, /read-only/i);
  assert.match(definition.description, /not inspected/i);
});

test('arguments map to scanner options, with the web profile as default', async () => {
  const calls = [];
  const definition = tool(async options => { calls.push(options); return result(); });

  await definition.execute({}, exec);
  await definition.execute({ profile: 'desktop', candidate: '/src/plugin', dshVersion: '0.2.1-rc.2' }, exec);

  assert.deepEqual(calls[0], { profile: DEFAULT_PROFILE, candidate: undefined, runtimeVersion: undefined });
  assert.deepEqual(calls[1], { profile: 'desktop', candidate: '/src/plugin', runtimeVersion: '0.2.1-rc.2' });
});

test('a passing and a failing result are reported with their status and exit code', async () => {
  const pass = await tool(async () => result()).execute({}, exec);
  assert.equal(pass.status, 'pass');
  assert.equal(pass.exit_code, 0);
  assert.match(pass.summary, /RESULT: STATIC PASS/);

  const finding = { rule: 'R1', severity: 'fatal', message: "MCP serverName 'x' is registered more than once in the same scope", plugins: ['a', 'b'], source: '/x/b/cordis.patch.yml' };
  const fail = await tool(async () => result({ status: 'fail', exit_code: 1, fatal_count: 1, findings: [finding] })).execute({}, exec);
  assert.equal(fail.exit_code, 1);
  assert.match(fail.summary, /\[FATAL\] \(R1\)/);
  assert.match(fail.summary, /plugins: a, b/);
  assert.match(fail.summary, /source: \/x\/b\/cordis\.patch\.yml/);
  assert.equal(JSON.parse(fail.report).findings[0].rule, 'R1');
});

test('an incomplete result lists its coverage limits and what was not inspected', async () => {
  const value = await tool(async () => result({
    status: 'incomplete',
    exit_code: 3,
    coverage: { selected_bundles: 0, resolved_bundles: 0, config_complete: false, runtime: 'not-inspected', limitations: ['profile selects no bundles; no plugin audit was performed'], not_checked: [] },
  })).execute({}, exec);
  assert.equal(value.status, 'incomplete');
  assert.match(value.summary, /Coverage limits:/);
  assert.match(value.summary, /no plugin audit was performed/);
  assert.match(value.summary, /were not inspected/);
});

test('long finding lists are capped in the summary but complete in the report', async () => {
  const findings = Array.from({ length: FINDING_LIMIT + 5 }, (_, i) => ({ rule: 'DSH_PATCH', severity: 'medium', message: `finding ${i}`, plugins: [], source: undefined }));
  const value = await tool(async () => result({ findings })).execute({}, exec);
  assert.match(value.summary, /and 5 more findings/);
  assert.ok(!value.summary.includes(`finding ${FINDING_LIMIT + 4}`));
  assert.equal(JSON.parse(value.report).findings.length, FINDING_LIMIT + 5);
});

test('the compact report drops the per-entry list but keeps the count', () => {
  const report = compactReport(result());
  assert.equal(report.entry_count, 1);
  assert.ok(!('entries' in report));
  assert.deepEqual(report.packages, [{ name: 'a', selected_as: 'a', version: '1.0.0', source: 'profile', compatibility: 'compatible' }]);
});

test('scanner failures never echo their message, which could quote credentials', async () => {
  const value = await tool(async () => { throw new Error('Unexpected token in {"apiKey":"DO_NOT_LEAK"}'); }).execute({}, exec);
  assert.equal(value.status, 'error');
  assert.equal(value.exit_code, 2);
  assert.equal(value.report, '');
  assert.ok(!JSON.stringify(value).includes('DO_NOT_LEAK'));
});

test('a missing dependency is reported as a setup problem', async () => {
  const value = await tool(async () => { throw Object.assign(new Error('Cannot find package js-yaml'), { code: 'ERR_MODULE_NOT_FOUND' }); }).execute({}, exec);
  assert.equal(value.status, 'error');
  assert.match(value.summary, /dependencies are missing/);
});

test('non-string arguments are rejected before the scanner runs', async () => {
  let called = false;
  const value = await tool(async () => { called = true; return result(); }).execute({ profile: 42 }, exec);
  assert.equal(called, false);
  assert.equal(value.status, 'error');
  assert.match(value.summary, /profile must be a string/);
});

test('render shows the summary as one text block', () => {
  const definition = tool(async () => result());
  assert.deepEqual(definition.output.render({}, { summary: 'hello' }), [{ type: 'text', text: 'hello' }]);
});

test('formatSummary tolerates a sparse result', () => {
  const text = formatSummary({ profile: 'web', status: 'error' });
  assert.match(text, /runtime unknown/);
  assert.match(text, /RESULT: STATIC ERROR/);
});

test('the plugin entry registers exactly one tool against the tools service', async () => {
  const hooks = `
    export async function resolve(specifier, context, next) {
      if (specifier === '@deepseek-ai/dsh-tools') {
        return { url: 'data:text/javascript,export const defineTool = d => d;', shortCircuit: true };
      }
      return next(specifier, context);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);
  const entry = await import('../src/index.js');

  const registered = [];
  entry.apply({ tools: { register: definition => { registered.push(definition); } } });

  assert.deepEqual(entry.inject, ['tools']);
  assert.equal(entry.name, 'plugin-health-check');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, TOOL_NAME);
});
