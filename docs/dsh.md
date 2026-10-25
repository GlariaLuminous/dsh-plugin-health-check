# DSH native profile checks

The native mode checks configuration without loading audited plugins. Its baseline is DeepSeek Harness `0.2.1-rc.2`; other versions expose their version and unresolved coverage rather than inheriting a compatibility claim.

## Run

Install Node.js 22+, then in the repository or installed skill directory:

```sh
npm ci --ignore-scripts
node scripts/dsh_health_check.mjs --profile desktop --json
node scripts/dsh_health_check.mjs --profile web --candidate /path/to/package --json
```

Python 3.8+ users can run the collector through `python scripts/plugin_health_check.py --host dsh` with the same options. The original directory scanner remains Python-only and uses `--root`; combining `--root` with `--host dsh` is rejected.

| Option | Purpose |
|---|---|
| `--profile NAME` | Profile under `$DSH_HOME/profiles`; defaults to `desktop` |
| `--dsh-home DIR` | Defaults to `DSH_HOME` or the user's `.dsh` |
| `--dsh-install DIR` | Installation containing `node_modules`; repeat to add resolution anchors |
| `--dsh-version VERSION` | Explicit runtime version when package discovery is unavailable |
| `--patch FILE` | Additional invocation patch; repeat in application order |
| `--candidate DIR` | Local package to add or replace by manifest identity |
| `--json` | Structured report on stdout |

Standard Windows/macOS Desktop installations are detected. Electron packages inside `resources/app.asar/dsh/node_modules` are read directly: Electron need not run. For custom or Linux installations, supply their package directory with `--dsh-install`. This may be a virtual ASAR path, for example `C:/Program Files/DeepSeek Harness/resources/app.asar/dsh`.

The runtime version is read from DSH installation packages, not Node.js or Electron versions. Explicit `--dsh-version` is the user's assertion about the target runtime.

## Checks

- Profile manifest and ordered `dsh.profile.bundles`; ordinary unselected dependencies are excluded.
- Resolution of scoped, pnpm-linked and Desktop-bundled packages; bundle patch declarations and entry availability.
- DSH admission: `engines.dsh` takes precedence; otherwise DSH peers are checked with prereleases included. Workspace peers and exact `compatibility.json` exemptions follow DSH's contract.
- Bundle patches, profile patch, home patch and invocation overlays in order. The official `@deepseek-ai/cordis-plugin-include` algorithm replaces config values rather than deep-merging them.
- Disabled/grouped entries and static `cordis:include` files, nested patch lists and include cycles.
- Static MCP `serverName` validity and duplicates within the known profile scope, plus minimum stdio/HTTP configuration.
- Local candidate replacement and finding differences. Existing baseline state is reported separately; a failing/incomplete baseline prevents a clean pass.

Reports contain package paths, entry identities and findings, but omit config bodies, credentials and YAML error excerpts. Installation paths are local environment metadata to consider before sharing a report.

## Results and coverage

| Code | Status | Meaning |
|---|---|---|
| 0 | `pass` | Covered static configuration checks passed |
| 1 | `fail` | Fatal finding |
| 2 | `error` | Invalid input, unreadable profile or missing setup |
| 3 | `incomplete` | Unknown version, empty scan, dynamic config or unresolved scope/module |

JSON includes `packages`, sanitized `entries`, `findings`, `fatal_count`, `status`, `exit_code`, and `coverage`. Coverage includes selected/resolved counts, `config_complete`, limitations, and `runtime: "not-inspected"`. An incompatible selected bundle remains visible, but its patch is excluded unless an exact exemption admits it. Exact exemptions remain visible security findings, not compatibility proof.

`!!js` remains data, never evaluated. Expression-dependent entries, isolated/intercepted services, and unresolved module export maps make coverage incomplete. No candidate apply, install hook, MCP process or remote server starts.

Runtime tools, commands and hooks, Agent presets/scopes, effective session permissions and dynamic MCP discovery require host runtime inspection. They are listed in `coverage.not_checked`. Plain Cordis groups share their enclosing static scope; service isolation is not guessed. The legacy 56-character-name, total 15000-token budget and `plugin.json.permissions` assumptions are not applied to DSH.

## Install as a DSH skill

Place the complete repository at `$DSH_HOME/skills/plugin-health-check/` or `<project-root>/.dsh/skills/plugin-health-check/`, then run `npm ci --ignore-scripts` there. Keep `scripts/` beside `SKILL.md`. Cloning into an arbitrary directory does not register the skill.

Invoke `/plugin-health-check` or ask the agent to audit a DSH profile. The skill directs the agent to execute from its base directory and include runtime limitations in its summary. It does not change the audited profile.

## Validation

```sh
npm test
python tests/run_tests.py
```

Tests construct temporary profiles/archives; a DSH installation is not required. They cover ordered overrides, disabled groups, exact exemptions, candidate updates, no-execution boundaries, sanitized failures, ASAR metadata, and native/Python CLI exit codes.

Host contracts: [profile composition](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/app-boot/README.md), [compatibility](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/app-boot/src/plugin-compatibility.ts), [MCP naming](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/mcp/mcp-client/src/tools.ts), [skill discovery](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/skill/skill-filesystem/src/index.ts).
