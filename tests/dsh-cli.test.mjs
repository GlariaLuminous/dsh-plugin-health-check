import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function home(t, manifest = { dsh: { profile: { bundles: [] } } }) {
  const dir = mkdtempSync(join(tmpdir(), 'phc-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'profiles/desktop'), { recursive: true });
  writeFileSync(join(dir, 'profiles/desktop/package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}
const cli = resolve('scripts/dsh_health_check.mjs');

test('CLI emits parseable JSON with exit 3 for an empty profile', t => {
  const result = spawnSync(process.execPath, [cli, '--dsh-home', home(t), '--dsh-version', '0.2.1-rc.2', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.coverage.selected_bundles, 0);
});

test('CLI setup errors do not echo malformed manifest secrets', t => {
  const result = spawnSync(process.execPath, [cli, '--dsh-home', home(t, '{"apiKey":"DO_NOT_LEAK", invalid}'), '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'error');
  assert.ok(!(result.stdout + result.stderr).includes('DO_NOT_LEAK'));
});

test('Python DSH entry forwards native output and exit status', t => {
  const result = spawnSync(process.env.PYTHON || 'python', ['scripts/plugin_health_check.py', '--host', 'dsh',
    '--dsh-home', home(t), '--dsh-version', '0.2.1-rc.2', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 3, result.stderr);
  assert.equal(JSON.parse(result.stdout).host, 'dsh');
});

test('DSH entry rejects a legacy --root rather than silently scanning a different directory', t => {
  const result = spawnSync(process.env.PYTHON || 'python', ['scripts/plugin_health_check.py', '--host', 'dsh',
    '--root', home(t), '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--root/);
});
