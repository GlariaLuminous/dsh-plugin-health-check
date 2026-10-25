<p align="center">
  <img src="assets/hero.svg" width="860" alt="plugin-health-check: DeepSeek Harness plugin checks">
</p>

<p align="center">
  <strong>Check your DSH plugins before installing them.</strong><br>
  Read-only profile and plugin checks for DeepSeek Harness
</p>

<p align="center">
  <a href="#install-as-a-dsh-plugin">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#checks">Checks</a> ·
  <a href="docs/dsh.md">Reference</a> ·
  <a href="README.md">中文</a>
</p>

DSH plugin availability depends on selected bundles, ordered patches, package resolution and runtime compatibility. This tool follows **profile → bundle → patch → configuration entries** and reports both findings and inspection coverage.

**DSH is the only supported host.** Audited plugins never execute and profile files remain unchanged. Requires Node.js 22+; verified against DSH Desktop 0.2.1-rc.2.

## Install as a DSH plugin

One command adds it to a profile; after a restart the agent has a read-only `plugin_health_check` tool:

```bash
dsh plugin --profile web add github:GlariaLuminous/plugin-health-check
```

Then ask the agent to "check my DSH plugins", or "will /path/to/plugin conflict with what I have?"; it passes the folder as `candidate`. The tool only reads files: it starts no plugin, runs no command and changes no configuration.

> **Status: experimental.** The check engine (CLI) is verified on DSH Desktop 0.2.1-rc.2. The agent-tool entry is new: its registration is covered by host-independent tests, but it has not yet been used in a real DSH session. Please file an issue with your DSH version if something is off. DSH is a developer preview, so re-check after upgrades.

Without installing into a profile, use the CLI directly:

```bash
npx dsh-plugin-health-check --profile web
```

## Quick start

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
cd plugin-health-check
npm ci --ignore-scripts
node scripts/dsh_health_check.mjs --profile desktop
```

```bash
node scripts/dsh_health_check.mjs --profile web --json
node scripts/dsh_health_check.mjs --dsh-home /path/to/.dsh --profile desktop
```

Home defaults to `DSH_HOME` or `~/.dsh`. Standard Windows/macOS Desktop installations are detected, including packages inside ASAR. Custom installations can supply a directory containing DSH's `node_modules` through `--dsh-install`.

The optional Python 3.8+ launcher forwards the same DSH arguments and still requires Node.js and the installed dependencies:

```bash
python scripts/plugin_health_check.py --profile desktop --json
```

<p align="center">
  <img src="assets/demo.svg" width="860" alt="Illustrative DSH output: duplicate MCP serverName in one scope, resulting in STATIC FAIL">
</p>

## Checks

| Area | Coverage |
|---|---|
| Profiles and bundles | Selected bundles, scoped packages, pnpm links and Desktop ASAR metadata |
| Version admission | DSH engines, peer fallback, prereleases and exact-version exemptions |
| Patches and includes | Official Cordis composition semantics, disabled/grouped entries, static includes and include cycles |
| MCP configuration | Same known-scope serverName conflicts, naming rules and basic stdio/HTTP settings |
| Candidate updates | Replace existing package identity, recompose and report new findings with baseline state |
| Inspection coverage | Selected/resolved counts, dynamic expressions, unresolved modules and unknown service isolation |

## Before installation or update

Pass a local source or unpacked package directory:

```bash
node scripts/dsh_health_check.mjs --profile desktop --candidate /path/to/plugin --json
```

The candidate is never installed and its build scripts/apply function never run. A matching package replaces the installed identity. A failing or incomplete baseline prevents a clean candidate verdict.

## Results

| Exit | Status | Meaning |
|---|---|---|
| `0` | `pass` | Covered static checks passed |
| `1` | `fail` | Fatal findings |
| `2` | `error` | Input or setup error |
| `3` | `incomplete` | Inspection requires more information or runtime verification |

JSON exposes packages, sanitized entries, findings, coverage, status and exit code. Config bodies, credentials and YAML error excerpts are excluded; installation paths remain for diagnosis.

This is static inspection. Runtime tools, commands/hooks, Agent presets, MCP connectivity/discovery and effective session permissions are not verified. JavaScript expressions remain unevaluated. A static pass does not assert successful plugin activation.

## Use as a DSH skill

Place the complete repository under `$DSH_HOME/skills/plugin-health-check/` or `<project-root>/.dsh/skills/plugin-health-check/` and run `npm ci --ignore-scripts` there. Keep `SKILL.md` beside `scripts/`, then invoke `/plugin-health-check` or ask the agent to check a DSH profile.

See the [DSH reference](docs/dsh.md) for options and limitations. The CLI now targets DSH directly; `--host`, `--root`, `--online` and `--desc-budget` have been removed.

## Development

```bash
npm test
```

Tests construct temporary profiles and ASAR files, with no DSH installation required. Python launcher tests also require Python 3.8+. Contributions should include a minimal DSH fixture, host version and expected behavior; remove credentials and personal paths before sharing.

[MIT](LICENSE)
