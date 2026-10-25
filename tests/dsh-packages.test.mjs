import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PackageReader, compatibility, readJson } from '../scripts/dsh/packages.mjs';

test('DSH engine takes priority; fallback peers admit prereleases and workspace peers', () => {
  const runtime = '0.2.1-rc.2';
  assert.equal(compatibility({ engines: { dsh: '>=0.2.0-0' }, peerDependencies: {
    '@deepseek-ai/dsh-tools': '999.0.0',
  } }, runtime).status, 'compatible');
  assert.equal(compatibility({ peerDependencies: { '@deepseek-ai/dsh-tools': '^0.2.0',
    '@deepseek-ai/dsh-skill': 'workspace:*' } }, runtime).status, 'compatible');
  assert.equal(compatibility({ engines: { dsh: '' } }, runtime).status, 'incompatible');
  assert.equal(compatibility({ engines: { dsh: null } }, runtime).status, 'invalid');
  assert.equal(compatibility({ engines: null }, runtime).status, 'invalid');
  assert.equal(compatibility({ engines: { dsh: '*' } }, null).status, 'unknown');
});

test('Electron ASAR package metadata is readable without Electron or executing the archive', t => {
  const root = mkdtempSync(join(tmpdir(), 'phc-asar-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = Buffer.from(JSON.stringify({ name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.2' }));
  const tree = { files: { dsh: { files: { node_modules: { files: { '@deepseek-ai': { files: {
    'dsh-base': { files: { 'package.json': { size: data.length, offset: '0' } } },
  } } } } } } } };
  const header = Buffer.from(JSON.stringify(tree));
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(header.length + 8, 4);
  prefix.writeUInt32LE(header.length + 4, 8);
  prefix.writeUInt32LE(header.length, 12);
  const archive = join(root, 'app.asar');
  writeFileSync(archive, Buffer.concat([prefix, header, data]));
  assert.equal(readJson(join(archive, 'dsh/node_modules/@deepseek-ai/dsh-base/package.json')).version, '0.2.1-rc.2');
  assert.equal(new PackageReader(root, [join(archive, 'dsh')]).bundle('@deepseek-ai/dsh-base').source, 'installation');
});

test('only an exact package version and runtime exemption admits an incompatible bundle', () => {
  const pkg = { name: '@demo/plugin', version: '1.0.0', engines: { dsh: '<0.1.0' } };
  assert.equal(compatibility(pkg, '0.2.1-rc.2', { '@demo/plugin@1.0.0': ['0.2.1-rc.2'] }).status, 'exempted');
  assert.equal(compatibility(pkg, '0.2.1-rc.3', { '@demo/plugin@1.0.0': ['0.2.1-rc.2'] }).status, 'incompatible');
});

test('scoped packages resolve from profiles and official bundles from an installation', t => {
  const root = mkdtempSync(join(tmpdir(), 'phc-packages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profile = join(root, 'profile');
  const install = join(root, 'runtime');
  for (const [dir, name] of [[profile, '@demo/plugin'], [install, '@deepseek-ai/dsh-base']]) {
    const target = join(dir, 'node_modules', name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  }
  const reader = new PackageReader(profile, [install]);
  assert.equal(reader.bundle('@demo/plugin').manifest.name, '@demo/plugin');
  assert.equal(reader.bundle('@deepseek-ai/dsh-base').source, 'installation');
  assert.throws(() => reader.bundle('@missing/plugin'), /cannot resolve/i);
});
