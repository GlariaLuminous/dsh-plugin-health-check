---
name: plugin-health-check
description: Check DSH (DeepSeek Harness) profiles and native plugins for invalid bundle configuration, runtime version incompatibility, patch problems and MCP server conflicts. Use for "检查我的 DSH 插件", "DSH 插件冲突", "插件体检", or checking a local plugin before installation. Also supports the original plugin-directory scanner.
---

# Plugin Health Check

Run from this skill's base directory, or use absolute paths to its scripts. Do not assume the user's working directory contains scripts/.

## DSH audit

1. Identify the intended profile: desktop for the desktop application, web for the web launcher. Do not combine them as one running environment.
2. Check Node.js 22+ and repository dependencies. Setup is `npm ci --ignore-scripts` in the skill base directory. This installs checker dependencies, not audited plugins.
3. Run:

```bash
node scripts/dsh_health_check.mjs --profile desktop --json
```

Equivalent Python entry: `python scripts/plugin_health_check.py --host dsh --profile desktop --json`.

- Home defaults to DSH_HOME or ~/.dsh; use `--dsh-home DIR` for another location.
- If built-in packages cannot resolve, use `--dsh-install DIR` with the installation containing node_modules. Standard Windows/macOS Desktop installations, including ASAR, are detected.
- Use `--dsh-version VERSION` only when the actual runtime version is known. Never guess a version to make compatibility pass.
- `--patch FILE` adds an invocation overlay and is repeatable.

## Before installing or updating a local DSH plugin

Obtain source without executing install/build scripts, then:

```bash
node scripts/dsh_health_check.mjs --profile desktop --candidate /path/to/package --json
```

Candidates replace matching package identity or join the selected set. The report includes new findings and baseline status. An unhealthy baseline cannot produce a clean candidate verdict.

## Interpret the report

| Exit | Meaning | User-facing result |
|---|---|---|
| 0 | Covered static checks passed | No problems found in covered configuration checks |
| 1 | Fatal findings | Explain the blocking package/config and a concrete next step |
| 2 | Input/setup error | Correct profile, paths, dependencies or version and rerun |
| 3 | Incomplete inspection | Show missing coverage and what information is needed |

Include coverage.resolved_bundles / coverage.selected_bundles, runtime version and profile. Selected and disabled describe configuration, not successful runtime activation.

- DSH_VERSION: malformed/incompatible engine or DSH peer requirement. Exact-version exemptions remain security findings.
- DSH_PACKAGE: unresolved bundle/module, missing bundle declaration or unreadable entry.
- DSH_PATCH: invalid patch/include, cycle, ambiguous addressing or unmatched override.
- R1: static same-scope MCP serverName conflict; DSH refuses duplicate registration.
- R8: invalid basic MCP server/transport configuration.
- DSH_COVERAGE: dynamic expressions, isolated services or unresolved metadata were not evaluated.

Runtime tools/commands/hooks, Agent preset activation, MCP connections/discovery and effective session policies are not inspected. Do not apply legacy long-name collision, total skill-description budget or manifest permission assumptions to DSH. Never call a static pass "safe to install" or full runtime validation.

## Original directory mode

For an explicitly requested legacy directory scan:

```bash
python scripts/plugin_health_check.py --root /path/to/plugins --json
python scripts/plugin_health_check.py --root /path/to/plugins --candidate /path/to/plugin --json
```

This retains the original R1-R10 rules and Python-only dependencies. --online is available only here. Do not use a DSH profile as --root.

## Workflow

- Report only. Do not modify, move, disable or install audited plugins.
- Inspect the declared profile first. An empty result is incomplete, not proof of health.
- Give one concrete next step for each fatal finding; configuration changes remain the user's decision.
- Keep the summary short and preserve runtime limitations.
