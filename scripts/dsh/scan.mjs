/** Offline DSH profile audit. No plugin modules, shell commands or expressions are executed. */
import path from 'node:path';
import { homedir } from 'node:os';
import semver from 'semver';
import { PackageReader, compatibility, exists, installationRoots, isObject, readJson } from './packages.mjs';
import { compose, dynamic, readList } from './composition.mjs';

const ORDER = { fatal: 0, security: 1, high: 2, medium: 3, low: 4, info: 5 };
const MCP = '@deepseek-ai/dsh-mcp-client';

function runtimeVersion(reader, explicit) {
  if (explicit !== undefined) {
    if (!semver.valid(explicit)) throw new Error('--dsh-version must be a semantic version');
    return explicit;
  }
  for (const name of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh']) {
    try {
      const value = reader.locate(name, [...reader.installations, reader.profile]).manifest.version;
      if (semver.valid(value)) return value;
    } catch { /* Try the next runtime metadata source. */ }
  }
  return null;
}

function snapshot(options) {
  const home = path.resolve(options.home || process.env.DSH_HOME || path.join(homedir(), '.dsh'));
  const name = options.profile || 'desktop';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('profile must be a simple directory name');
  const profile = path.join(home, 'profiles', name);
  const manifest = readJson(path.join(profile, 'package.json'));
  const selected = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(selected) || !selected.every(v => typeof v === 'string' && v)) {
    throw new Error('profile package.json must declare dsh.profile.bundles as an array of package names');
  }
  const reader = new PackageReader(profile, options.installations ?? installationRoots());
  const version = runtimeVersion(reader, options.runtimeVersion);
  const findings = [];
  const limitations = new Set();
  const packages = [];
  const entries = [];
  let configComplete = true;
  const add = (rule, severity, message, plugins = [], source) => findings.push({ rule, severity, message, plugins, source });
  const unknown = (message, source) => {
    configComplete = false;
    limitations.add(message);
    add('DSH_COVERAGE', 'info', message, [], source);
  };
  if (!version) unknown('DSH runtime version is unknown; specify --dsh-install or --dsh-version');
  if (!selected.length) unknown('profile selects no bundles; no plugin audit was performed');

  let exemptions = {};
  const exemptionFile = path.join(profile, 'compatibility.json');
  if (exists(exemptionFile)) {
    try {
      const raw = readJson(exemptionFile);
      for (const [key, versions] of Object.entries(raw)) {
        const split = key.lastIndexOf('@');
        if (split <= 0 || !semver.valid(key.slice(split + 1)) || !Array.isArray(versions) || !versions.every(v => typeof v === 'string' && semver.valid(v))) {
          add('DSH_VERSION', 'medium', 'invalid version exemption ignored', [], exemptionFile);
        } else exemptions[key] = versions;
      }
    } catch { add('DSH_VERSION', 'medium', 'unreadable compatibility.json; no exemptions granted', [], exemptionFile); }
  }

  let candidate;
  if (options.candidate) {
    const dir = path.resolve(options.candidate);
    const data = readJson(path.join(dir, 'package.json'));
    if (typeof data.name !== 'string' || !data.name) throw new Error('candidate requires a package name');
    candidate = { dir, manifest: data, source: 'candidate' };
  }
  const bundleNames = [...new Set(selected)];
  const replacements = new Set();
  if (candidate) {
    for (const id of bundleNames) {
      try { if (reader.bundle(id).manifest.name === candidate.manifest.name) replacements.add(id); }
      catch { /* Unresolved entries are reported in the bundle loop. */ }
    }
    if (!replacements.size) bundleNames.push(candidate.manifest.name);
    reader.overrides.set(candidate.manifest.name, candidate);
  }
  let composed = [];
  let resolved = 0;
  const origins = new Map();
  function admit(pkg, identity, source) {
    const result = compatibility(pkg, version, exemptions);
    if (result.status === 'incompatible' || result.status === 'invalid') {
      add('DSH_VERSION', 'fatal', result.status === 'invalid' ? 'malformed DSH version requirements' : 'package does not admit this DSH runtime', [identity], source);
    } else if (result.status === 'exempted') {
      add('DSH_VERSION', 'security', 'incompatible package has an exact-version exemption', [identity], source);
    }
    return result;
  }
  function patchLayer(file, owner) {
    try {
      const patches = readList(file);
      origins.set(file, owner);
      if (dynamic(patches)) unknown('dynamic configuration was not evaluated', file);
      composed = compose(composed, patches, message => add('DSH_PATCH', 'medium', message, owner ? [owner] : [], file));
    } catch { add('DSH_PATCH', 'fatal', 'cannot read a valid patch array', owner ? [owner] : [], file); }
  }
  for (const id of bundleNames) {
    let pkg;
    try {
      pkg = candidate && (replacements.has(id) || id === candidate.manifest.name) ? candidate : reader.bundle(id);
      if (!reader.bundleDirs.includes(pkg.dir)) reader.bundleDirs.push(pkg.dir);
      resolved++;
    } catch {
      add('DSH_PACKAGE', 'fatal', 'selected bundle cannot be resolved; check --dsh-install for shipped packages', [id]);
      configComplete = false;
      continue;
    }
    const check = admit(pkg.manifest, pkg.manifest.name || id, path.join(pkg.dir, 'package.json'));
    packages.push({ name: pkg.manifest.name || id, selected_as: id, version: pkg.manifest.version ?? null,
      source: pkg.source, path: pkg.dir, compatibility: check });
    if (['incompatible', 'invalid'].includes(check.status)) continue;
    const patch = pkg.manifest.dsh?.bundle?.patch;
    const files = typeof patch === 'string' ? [patch] : patch;
    if (!Array.isArray(files) || !files.length || !files.every(v => typeof v === 'string' && v)) {
      add('DSH_PACKAGE', 'fatal', 'selected package must declare dsh.bundle.patch', [id]);
      continue;
    }
    for (const file of files) patchLayer(path.resolve(pkg.dir, file), pkg.manifest.name || id);
  }
  for (const file of [path.join(profile, 'cordis.patch.yml'), path.join(home, 'cordis.patch.yml')]) {
    if (exists(file)) patchLayer(file);
  }
  for (const file of options.patches || []) patchLayer(path.resolve(file));

  const servers = new Map();
  const rowIds = new Set();
  const checkedModules = new Map();
  function walk(rows, scope = 'profile', disabled = false, includes = new Set(), depth = 0) {
    if (depth > 50) { unknown('nested configuration exceeds static scan depth'); return; }
    for (const row of rows) {
      const source = row._phc_source;
      const owner = origins.get(source);
      const inactive = disabled || row.disabled === true;
      if (!inactive && dynamic(row)) { unknown('expression-dependent entry requires runtime inspection', source); continue; }
      const record = { id: row.id ?? null, name: row.name ?? null, disabled: inactive, scope, source };
      entries.push(record);
      if (inactive) continue;
      const key = `${scope}\0${row.id}`;
      if (row.id && rowIds.has(key)) add('DSH_PATCH', 'high', 'duplicate entry id makes patch addressing ambiguous', owner ? [owner] : [], source);
      rowIds.add(key);
      if (row.group === true) {
        if (Array.isArray(row.config)) walk(row.config, scope, false, includes, depth + 1);
        else unknown('dynamic or malformed group entry', source);
        continue;
      }
      if (row.name === 'cordis:include') {
        const relative = row.config?.path;
        if (typeof relative !== 'string') { unknown('include path cannot be resolved statically', source); continue; }
        const file = path.resolve(path.dirname(source), relative);
        if (includes.has(file)) { add('DSH_PATCH', 'fatal', 'include cycle detected', [], source); continue; }
        try {
          const included = readList(file, false);
          origins.set(file, owner);
          const patches = row.config.patches ?? [];
          if (dynamic(patches)) { unknown('dynamic include patch was not evaluated', source); continue; }
          const next = compose(included, patches, message => add('DSH_PATCH', 'medium', message, [], source));
          walk(next, scope, false, new Set(includes).add(file), depth + 1);
        } catch { add('DSH_PATCH', 'fatal', 'cannot read static include entry list', [], file); }
        continue;
      }
      let module;
      try {
        module = reader.module(row.name, source ? path.dirname(source) : profile);
      } catch {
        // Export maps and # imports can need runtime resolution. Never claim successful coverage.
        unknown('entry module could not be resolved statically', source);
        add('DSH_PACKAGE', 'high', 'check entry module path, exports and installed dependencies', owner ? [owner] : [], source);
        continue;
      }
      if (module.manifest) {
        if (!checkedModules.has(module.dir)) checkedModules.set(module.dir, admit(module.manifest, module.manifest.name, module.filename));
        if (['incompatible', 'invalid'].includes(checkedModules.get(module.dir).status)) continue;
      }
      if (row.name === MCP) {
        const config = row.config;
        const server = config?.serverName;
        if (typeof server !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(server)) {
          add('R8', 'fatal', 'MCP serverName must match [A-Za-z0-9_-]{1,32}', owner ? [owner] : [], source);
          continue;
        }
        record.server_name = server;
        if (!['stdio', 'streamable-http'].includes(config.transport)) add('R8', 'fatal', 'unsupported MCP transport', owner ? [owner] : [], source);
        if (config.transport === 'stdio' && typeof config.command !== 'string') add('R8', 'fatal', 'stdio MCP requires command', [], source);
        if (config.transport === 'streamable-http') {
          try { if (!['http:', 'https:'].includes(new URL(config.url).protocol)) throw new Error(); }
          catch { add('R8', 'fatal', 'remote MCP requires an absolute HTTP(S) URL', [], source); }
        }
        const identity = `${scope}\0${server}`;
        if (servers.has(identity)) add('R1', 'fatal', 'MCP serverName is registered more than once in the same scope',
          [...new Set([servers.get(identity), owner].filter(Boolean))], source);
        else servers.set(identity, owner);
      }
    }
  }
  walk(composed);
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.rule.localeCompare(b.rule));
  const fatalCount = findings.filter(f => f.severity === 'fatal').length;
  return { host: 'dsh', profile: name, root: profile, runtime_version: version, packages, entries, findings,
    fatal_count: fatalCount, coverage: { selected_bundles: bundleNames.length, resolved_bundles: resolved,
      config_complete: configComplete, runtime: 'not-inspected', limitations: [...limitations],
      not_checked: ['runtime tools/commands/hooks', 'Agent preset activation and scopes', 'MCP connection and tools/list', 'effective session permissions'] },
    status: fatalCount ? 'fail' : configComplete ? 'pass' : 'incomplete' };
}

/** Candidate mode recomposes the profile and compares findings; updates replace package identity. */
export function auditDsh(options = {}) {
  const result = snapshot(options);
  if (options.candidate) {
    const before = snapshot({ ...options, candidate: undefined });
    const key = f => JSON.stringify([f.rule, f.severity, f.message, f.plugins, f.source]);
    const existing = new Set(before.findings.map(key));
    result.findings = result.findings.filter(f => !existing.has(key(f)));
    result.fatal_count = result.findings.filter(f => f.severity === 'fatal').length;
    result.baseline = { status: before.status, fatal_count: before.fatal_count };
    result.status = result.fatal_count ? 'fail' : result.coverage.config_complete && before.status === 'pass' ? 'pass' : 'incomplete';
  }
  result.exit_code = result.status === 'fail' ? 1 : result.status === 'incomplete' ? 3 : 0;
  return result;
}
