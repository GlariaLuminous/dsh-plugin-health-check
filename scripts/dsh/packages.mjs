/** Read package metadata, including Electron ASAR files, without importing plugins. */
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const archives = new Map();
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function archiveEntry(filename) {
  const match = /^(.*?\.asar)[/\\](.*)$/.exec(filename);
  if (!match) return null;
  const [, archive, inside] = match;
  if (!archives.has(archive)) {
    const fd = fs.openSync(archive, 'r');
    try {
      const prefix = Buffer.alloc(16);
      if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('invalid ASAR header');
      const headerSize = prefix.readUInt32LE(12);
      if (headerSize > 64 * 1024 * 1024) throw new Error('ASAR header too large');
      const bytes = Buffer.alloc(headerSize);
      if (fs.readSync(fd, bytes, 0, headerSize, 16) !== headerSize) throw new Error('truncated ASAR header');
      archives.set(archive, { tree: JSON.parse(bytes.toString('utf8')), offset: 8 + prefix.readUInt32LE(4) });
    } finally { fs.closeSync(fd); }
  }
  const { tree, offset } = archives.get(archive);
  let entry = tree;
  let parts = inside.split(/[/\\]/).filter(Boolean);
  // Archive links are root-relative, just as Electron's ASAR reader treats them.
  for (let links = 0; links < 16; links++) {
    entry = tree;
    let redirected = false;
    for (let i = 0; i < parts.length; i++) {
      entry = entry.files?.[parts[i]];
      if (!entry) return null;
      if (entry.link) {
        parts = [...entry.link.split('/'), ...parts.slice(i + 1)];
        redirected = true;
        break;
      }
    }
    if (!redirected) return { archive, inside: parts.join('/'), entry, offset };
  }
  throw new Error('ASAR link cycle');
}

export function exists(filename) {
  try { return fs.existsSync(filename) || Boolean(archiveEntry(filename)); }
  catch { return false; }
}

export function readText(filename) {
  const archived = archiveEntry(filename);
  if (!archived) return fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
  const { archive, inside, entry, offset } = archived;
  if (entry.unpacked) return fs.readFileSync(`${archive}.unpacked/${inside}`, 'utf8').replace(/^\uFEFF/, '');
  if (!Number.isSafeInteger(entry.size) || entry.size > 16 * 1024 * 1024 || entry.offset === undefined) {
    throw new Error('invalid or oversized ASAR file');
  }
  const fd = fs.openSync(archive, 'r');
  try {
    const bytes = Buffer.alloc(entry.size);
    if (fs.readSync(fd, bytes, 0, entry.size, offset + Number(entry.offset)) !== entry.size) {
      throw new Error('truncated ASAR file');
    }
    return bytes.toString('utf8').replace(/^\uFEFF/, '');
  } finally { fs.closeSync(fd); }
}

export function readJson(filename) {
  const value = JSON.parse(readText(filename));
  if (!isObject(value)) throw new Error('JSON root must be an object');
  return value;
}

export function installationRoots(explicit = []) {
  const candidates = [...explicit, process.env.DSH_INSTALL_DIR];
  if (process.platform === 'win32') {
    for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles]) {
      if (base) candidates.push(path.join(base, 'DeepSeek Harness', 'resources', 'app.asar', 'dsh'));
    }
  } else if (process.platform === 'darwin') {
    for (const base of ['/Applications', path.join(homedir(), 'Applications')]) {
      candidates.push(path.join(base, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar', 'dsh'));
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const executable of ['dsh', 'dsh.cmd']) {
      try {
        let parent = path.dirname(fs.realpathSync(path.join(dir, executable)));
        for (let depth = 0; depth < 4; depth++, parent = path.dirname(parent)) candidates.push(parent);
      } catch { /* Not a DSH executable directory. */ }
    }
    candidates.push(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh'));
    candidates.push(path.resolve(dir, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  }
  return [...new Set(candidates.filter(Boolean).map(p => path.resolve(p)))];
}

function packageName(specifier) {
  const match = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9][a-z0-9._-]*)(?=\/|$)/i.exec(specifier);
  return match?.[0];
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (isObject(value)) {
    for (const [condition, target] of Object.entries(value)) {
      if (['node', 'import', 'default'].includes(condition)) {
        const resolved = exportTarget(target);
        if (resolved) return resolved;
      }
    }
  }
  return undefined;
}

export class PackageReader {
  constructor(profile, installations = []) {
    this.profile = path.resolve(profile);
    this.installations = installations.map(p => path.resolve(p));
    this.bundleDirs = [];
  }

  locate(name, roots) {
    for (const root of roots) {
      for (const dir of [path.join(root, 'node_modules', name), root]) {
        const filename = path.join(dir, 'package.json');
        if (!exists(filename)) continue;
        const manifest = readJson(filename);
        if (dir === root && manifest.name !== name) continue;
        return { dir, manifest, source: this.installations.includes(root) ? 'installation' : 'profile' };
      }
    }
    throw new Error(`cannot resolve package ${name}`);
  }

  bundle(name) {
    if (typeof name !== 'string' || packageName(name) !== name) throw new Error('bundle must be a package name');
    const pkg = this.locate(name, [...this.installations, this.profile]);
    if (!this.bundleDirs.includes(pkg.dir)) this.bundleDirs.push(pkg.dir);
    return pkg;
  }

  module(specifier, base) {
    if (typeof specifier !== 'string' || !specifier) throw new Error('module name must be a non-empty string');
    if (specifier.startsWith('cordis:')) return { builtin: true };
    if (specifier.startsWith('.') || path.isAbsolute(specifier) || specifier.startsWith('file:')) {
      const filename = specifier.startsWith('file:') ? fileURLToPath(specifier) : path.resolve(base, specifier);
      if (!exists(filename)) throw new Error(`module file not found: ${specifier}`);
      return { filename };
    }
    const name = packageName(specifier);
    if (!name) throw new Error(`unsupported module specifier: ${specifier}`);
    const ancestors = [];
    for (let dir = base; ; dir = path.dirname(dir)) {
      ancestors.push(dir);
      if (path.dirname(dir) === dir) break;
    }
    const pkg = this.locate(name, [this.profile, ...ancestors, ...this.installations, ...this.bundleDirs]);
    const subpath = specifier.slice(name.length);
    const exports = pkg.manifest.exports;
    let entry;
    if (exports !== undefined) {
      const map = isObject(exports) && Object.keys(exports).some(k => k.startsWith('.'));
      entry = exportTarget(map ? exports[subpath ? `.${subpath}` : '.'] : subpath ? undefined : exports);
      if (!entry) throw new Error(`module export cannot be resolved statically: ${specifier}`);
    } else entry = subpath ? `.${subpath}` : pkg.manifest.main || 'index.js';
    const filename = path.resolve(pkg.dir, entry);
    if (!exists(filename)) throw new Error(`module entry not found: ${specifier}`);
    return { ...pkg, filename };
  }
}

/** Follow DSH admission: engines.dsh wins, otherwise all DSH peers; prereleases participate. */
export function compatibility(manifest, runtime, exemptions = {}) {
  try {
    const requirements = {};
    const engines = manifest.engines ?? {};
    if (!isObject(engines)) throw new Error('engines must be an object');
    if (Object.hasOwn(engines, 'dsh')) requirements['engines.dsh'] = engines.dsh;
    else {
      const peers = manifest.peerDependencies ?? {};
      if (!isObject(peers)) throw new Error('peerDependencies must be an object');
      for (const [name, range] of Object.entries(peers)) {
        if (typeof range !== 'string') throw new Error('peer ranges must be strings');
        if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) requirements[name] = range;
      }
    }
    for (const range of Object.values(requirements)) {
      if (typeof range !== 'string') throw new Error('DSH version range must be a string');
    }
    if (!Object.keys(requirements).length) return { status: 'unconstrained' };
    if (!semver.valid(runtime)) return { status: 'unknown' };
    const unmet = Object.fromEntries(Object.entries(requirements).filter(([name, range]) => {
      const effective = name !== 'engines.dsh' && ['workspace:*', 'workspace:^', 'workspace:~'].includes(range) ? runtime : range;
      return !effective.trim() || !semver.satisfies(runtime, effective, { includePrerelease: true });
    }));
    if (!Object.keys(unmet).length) return { status: 'compatible' };
    const allowed = exemptions[`${manifest.name}@${manifest.version}`];
    return { status: Array.isArray(allowed) && allowed.includes(runtime) ? 'exempted' : 'incompatible', requirements: unmet };
  } catch (error) { return { status: 'invalid', problem: error.message }; }
}
