import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditDsh } from '../scripts/dsh/scan.mjs';

function fixture(t, names = ['@demo/a']) {
  const home = mkdtempSync(join(tmpdir(), 'phc-dsh-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const profile = join(home, 'profiles', 'desktop');
  const write = (file, value) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write(join(profile, 'package.json'), { dsh: { profile: { bundles: names } } });
  write(join(profile, 'cordis.patch.yml'), '[]');
  function bundle(name, rows, extra = {}) {
    const dir = join(profile, 'node_modules', name);
    write(join(dir, 'package.json'), { name, version: '1.0.0', main: 'index.js',
      dsh: { bundle: { patch: 'cordis.patch.yml' } }, ...extra });
    write(join(dir, 'index.js'), 'throw new Error("CANDIDATE MUST NOT EXECUTE");');
    write(join(dir, 'cordis.patch.yml'), [{ insert: rows }]);
    return dir;
  }
  bundle('@demo/a', [{ id: 'a', name: '@demo/a' }]);
  return { home, profile, write, bundle, options: { home, profile: 'desktop', runtimeVersion: '0.2.1-rc.2', installations: [] } };
}

test('native bundles are discovered; installed but unselected packages are not audited', t => {
  const f = fixture(t);
  f.bundle('unused', [{ id: 'bad', name: 'missing' }]);
  const result = auditDsh(f.options);
  assert.equal(result.status, 'pass');
  assert.equal(result.coverage.selected_bundles, 1);
  assert.equal(result.packages.length, 1);
  assert.equal(result.entries[0].name, '@demo/a');
  assert.equal(result.coverage.runtime, 'not-inspected');
});

test('DSH config overrides replace entire config and home/CLI layers win', t => {
  const f = fixture(t, ['@demo/a', '@demo/b']);
  f.bundle('@demo/a', [{ id: 'one', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'same', transport: 'stdio', command: 'x' } }]);
  f.bundle('@demo/b', [{ id: 'two', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'same', transport: 'stdio', command: 'x' } }]);
  f.bundle('@deepseek-ai/dsh-mcp-client', []);
  assert.ok(auditDsh(f.options).findings.some(v => v.rule === 'R1'));
  f.write(join(f.profile, 'cordis.patch.yml'), [{ id: 'two', config: { serverName: 'different', transport: 'stdio', command: 'x' } }]);
  assert.ok(!auditDsh(f.options).findings.some(v => v.rule === 'R1'));
  f.write(join(f.home, 'cordis.patch.yml'), [{ id: 'two', disabled: true }]);
  const overlay = join(f.home, 'overlay.yml');
  f.write(overlay, [{ id: 'two', disabled: false, config: { serverName: 'same', transport: 'stdio', command: 'x' } }]);
  assert.ok(auditDsh({ ...f.options, patches: [overlay] }).findings.some(v => v.rule === 'R1'));
});

test('disabled groups are excluded from conflicts and missing module checks', t => {
  const f = fixture(t);
  f.bundle('@demo/a', [{ id: 'group', name: 'cordis:group', group: true, disabled: true,
    config: [{ id: 'missing', name: 'missing-module' }] }]);
  assert.equal(auditDsh(f.options).status, 'pass');
});

test('version mismatches fail; exact exemptions are visible and read-only', t => {
  const f = fixture(t);
  f.bundle('@demo/a', [], { engines: { dsh: '<0.1.0' } });
  assert.ok(auditDsh(f.options).findings.some(v => v.rule === 'DSH_VERSION' && v.severity === 'fatal'));
  const exemptions = join(f.profile, 'compatibility.json');
  f.write(exemptions, { '@demo/a@1.0.0': ['0.2.1-rc.2'] });
  const before = readFileSync(exemptions, 'utf8');
  assert.equal(auditDsh(f.options).packages[0].compatibility.status, 'exempted');
  assert.equal(readFileSync(exemptions, 'utf8'), before);
});

test('empty profiles, missing runtime version and dynamic expressions are incomplete', t => {
  const f = fixture(t, []);
  assert.equal(auditDsh(f.options).status, 'incomplete');
  f.write(join(f.profile, 'package.json'), { dsh: { profile: { bundles: ['@demo/a'] } } });
  assert.equal(auditDsh({ ...f.options, runtimeVersion: undefined }).status, 'incomplete');
  f.write(join(f.profile, 'cordis.patch.yml'), '- id: a\n  disabled: !!js "(() => { throw new Error(\'DO NOT EXECUTE\') })()"\n');
  assert.equal(auditDsh(f.options).status, 'incomplete');
});

test('local candidates replace installed identity and report only new findings', t => {
  const f = fixture(t);
  const candidate = join(f.home, 'candidate');
  f.write(join(candidate, 'package.json'), { name: '@demo/a', version: '2.0.0', main: 'index.js',
    dsh: { bundle: { patch: './patch.yml' } }, engines: { dsh: '<0.1.0' } });
  f.write(join(candidate, 'patch.yml'), []);
  f.write(join(candidate, 'index.js'), 'throw new Error("NEVER EXECUTE")');
  const result = auditDsh({ ...f.options, candidate });
  assert.equal(result.coverage.selected_bundles, 1);
  assert.equal(result.packages[0].version, '2.0.0');
  assert.ok(result.findings.some(v => v.rule === 'DSH_VERSION'));
  assert.equal(auditDsh({ ...f.options, candidate: join(f.profile, 'node_modules/@demo/a') }).findings.length, 0);
});

test('reports omit config secrets and preserve a JSON report for malformed patches', t => {
  const f = fixture(t);
  f.write(join(f.profile, 'cordis.patch.yml'), '- id: a\n  config:\n    token: DO_NOT_LEAK\n    broken: [\n');
  const result = auditDsh(f.options);
  assert.equal(result.status, 'fail');
  assert.ok(!JSON.stringify(result).includes('DO_NOT_LEAK'));
});

test('candidate module resolution uses the new package and a failing baseline cannot become PASS', t => {
  const f = fixture(t);
  const candidate = join(f.home, 'candidate');
  f.write(join(candidate, 'package.json'), { name: '@demo/a', version: '2.0.0', main: 'missing.js',
    dsh: { bundle: { patch: './patch.yml' } } });
  f.write(join(candidate, 'patch.yml'), [{ insert: [{ id: 'new-a', name: '@demo/a' }] }]);
  assert.equal(auditDsh({ ...f.options, candidate }).status, 'incomplete');
  f.bundle('@demo/a', [], { engines: { dsh: '<0.1.0' } });
  const unrelated = f.bundle('@demo/b', []);
  const result = auditDsh({ ...f.options, candidate: unrelated });
  assert.equal(result.baseline.status, 'fail');
  assert.equal(result.status, 'incomplete');
});

test('static include cycles fail and a disabled include never reads its missing path', t => {
  const f = fixture(t);
  const dir = f.bundle('@demo/a', [{ id: 'include', name: 'cordis:include', config: { path: './loop.yml' } }]);
  f.write(join(dir, 'loop.yml'), [{ id: 'loop', name: 'cordis:include', config: { path: './loop.yml' } }]);
  assert.ok(auditDsh(f.options).findings.some(v => v.message === 'include cycle detected'));
  f.bundle('@demo/a', [{ id: 'include', name: 'cordis:include', disabled: true, config: { path: './missing.yml' } }]);
  assert.equal(auditDsh(f.options).status, 'pass');
});
