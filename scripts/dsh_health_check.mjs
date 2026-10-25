#!/usr/bin/env node
/** CLI for the offline DSH collector. Importing this file does not run an audit. */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function main(args = process.argv.slice(2)) {
  let json = args.includes('--json');
  try {
    const { values } = parseArgs({ args, options: {
      'dsh-home': { type: 'string' }, profile: { type: 'string', default: 'desktop' },
      'dsh-install': { type: 'string', multiple: true }, 'dsh-version': { type: 'string' },
      patch: { type: 'string', multiple: true }, candidate: { type: 'string' },
      json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } });
    json = values.json;
    if (values.help) {
      console.log('DSH static profile check (Node.js 22+)\n'
        + '  node scripts/dsh_health_check.mjs --profile desktop [--json]\n'
        + '  --dsh-home DIR      DSH_HOME, otherwise ~/.dsh\n'
        + '  --dsh-install DIR   DSH installation containing node_modules (repeatable)\n'
        + '  --dsh-version VER   Explicit runtime version, if not discoverable\n'
        + '  --patch FILE        Additional invocation overlay (repeatable)\n'
        + '  --candidate DIR     Compare a local package without executing/installing it\n'
        + 'Exit: 0 static checks passed, 1 fatal, 2 input/setup error, 3 incomplete');
      return 0;
    }
    let auditDsh;
    try { ({ auditDsh } = await import('./dsh/scan.mjs')); }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('DSH dependencies are missing; run npm ci --ignore-scripts in the repository');
      throw error;
    }
    const result = auditDsh({ home: values['dsh-home'], profile: values.profile,
      installations: values['dsh-install'], runtimeVersion: values['dsh-version'],
      patches: values.patch, candidate: values.candidate });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`DSH static profile check: ${result.profile} (runtime ${result.runtime_version || 'unknown'})`);
      console.log(`Bundles: ${result.coverage.resolved_bundles}/${result.coverage.selected_bundles} resolved; entries: ${result.entries.length}`);
      if (result.baseline) console.log(`Installed baseline: ${result.baseline.status}; fatal findings: ${result.baseline.fatal_count}`);
      for (const finding of result.findings) {
        console.log(`[${finding.severity.toUpperCase()}] (${finding.rule}) ${finding.message}`);
        if (finding.source) console.log(`  source: ${finding.source}`);
      }
      console.log(`RESULT: STATIC ${result.status.toUpperCase()}`);
      console.log('Runtime activation, Agent presets, tool discovery and effective session permissions were not inspected.');
    }
    return result.exit_code;
  } catch (error) {
    // JSON/YAML parse errors can quote source snippets containing credentials.
    const message = error.message.startsWith('DSH dependencies are missing') ? error.message
      : 'Cannot inspect DSH input; check the profile manifest, paths, CLI options and runtime version.';
    if (json) console.log(JSON.stringify({ host: 'dsh', status: 'error', exit_code: 2, message }));
    else console.error(`error: ${message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
