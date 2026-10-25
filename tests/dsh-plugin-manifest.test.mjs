/**
 * The package must stay installable as a DSH bundle: the manifest declares the
 * patch, the patch inserts a row naming this package, and the published
 * tarball contains everything the entry imports.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { load } from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

test('package.json declares a bundle patch that exists', () => {
  const patch = manifest.dsh?.bundle?.patch;
  assert.equal(typeof patch, 'string');
  assert.ok(existsSync(resolve(root, patch)), `${patch} is missing`);
  assert.notEqual(manifest.private, true, 'a private package cannot be published');
});

test('the patch inserts one row that names this package', () => {
  const rows = load(readFileSync(resolve(root, manifest.dsh.bundle.patch), 'utf8'));
  assert.ok(Array.isArray(rows) && rows.length === 1);
  const inserted = rows[0].insert;
  assert.ok(Array.isArray(inserted) && inserted.length === 1);
  assert.equal(inserted[0].name, manifest.name);
  assert.equal(typeof inserted[0].id, 'string');
});

test('main, exports and bin point at real files', () => {
  assert.equal(manifest.exports['.'], `./${manifest.main}`);
  for (const target of [manifest.main, ...Object.values(manifest.bin), ...Object.values(manifest.exports)]) {
    assert.ok(existsSync(resolve(root, target)), `${target} is missing`);
  }
  const launcher = readFileSync(resolve(root, Object.values(manifest.bin)[0]), 'utf8');
  assert.ok(launcher.startsWith('#!/usr/bin/env node'));
});

test('the DSH tools package is an optional peer, so the CLI works without a host', () => {
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-tools']);
  assert.equal(manifest.peerDependenciesMeta['@deepseek-ai/dsh-tools'].optional, true);
  assert.ok(!manifest.dependencies['@deepseek-ai/dsh-tools']);
});

test('the published tarball contains the entry, scanner, patch and skill', () => {
  const packed = spawnSync('npm pack --dry-run --json --ignore-scripts', { cwd: root, encoding: 'utf8', shell: true });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(file => file.path.replaceAll('\\', '/'));
  for (const expected of ['src/index.js', 'src/tool.js', 'src/report.js', 'scripts/dsh/scan.mjs', 'scripts/dsh/packages.mjs', 'scripts/dsh/composition.mjs', 'scripts/dsh_health_check.mjs', 'cordis.patch.yml', 'SKILL.md', 'package.json']) {
    assert.ok(files.includes(expected), `${expected} is not packed`);
  }
  assert.ok(!files.some(file => file.startsWith('tests/')), 'tests should not be published');
});
