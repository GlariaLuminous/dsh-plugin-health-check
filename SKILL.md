---
name: plugin-health-check
description: Check DeepSeek Harness (DSH) profiles and plugins for invalid bundles, runtime version incompatibility, patch errors and MCP server conflicts. Use for "检查我的 DSH 插件", "DSH 插件冲突", "插件体检", or checking a local DSH plugin before installation or update.
---

# DSH plugin health check

This skill supports DeepSeek Harness only. Run from the skill's base directory or use absolute paths to its scripts.

## Audit a profile

1. Identify the intended profile: desktop for the desktop application, web for the web launcher. Do not combine them as one running environment.
2. Check Node.js 22+ and checker dependencies. Setup is `npm ci --ignore-scripts` in the skill base directory. This installs the checker dependencies, not audited plugins.
3. Run:

```bash
node scripts/dsh_health_check.mjs --profile desktop --json
```

The optional Python launcher accepts the same parameters: `python scripts/plugin_health_check.py --profile desktop --json`.

- Home defaults to DSH_HOME or ~/.dsh; use `--dsh-home DIR` for another location.
- Standard Windows/macOS Desktop installations, including ASAR packages, are detected. Use `--dsh-install DIR` for another installation containing node_modules.
- Supply `--dsh-version VERSION` only when the actual runtime version is known. Do not invent one to make checks pass.
- `--patch FILE` appends an invocation overlay and is repeatable.

## Check a local candidate

Obtain source without running install/build scripts, then:

```bash
node scripts/dsh_health_check.mjs --profile desktop --candidate /path/to/package --json
```

Matching package identity replaces the installed version; otherwise the candidate joins the selected set. Reports include new findings and baseline state. An unhealthy or incomplete baseline prevents a clean verdict.

## Explain results

| Exit | Meaning |
|---|---|
| 0 | Covered static configuration checks passed |
| 1 | Fatal findings; explain the affected package/config and a concrete next step |
| 2 | Input/setup error; correct paths, dependencies or version |
| 3 | Incomplete; show missing coverage and what information is required |

Include profile, runtime version, and resolved/selected bundle counts. Selected/disabled describe configuration, not successful activation.

- DSH_VERSION: invalid/incompatible engines or DSH peers; exact-version exemptions remain security findings.
- DSH_PACKAGE: unresolved bundle/module, missing declaration or entry.
- DSH_PATCH: invalid patch/include, cycle, ambiguous addressing or unmatched override.
- R1: static same-scope MCP serverName conflict; duplicate registration is refused.
- R8: invalid basic MCP server/transport configuration.
- DSH_COVERAGE: unevaluated expressions, isolated services or unresolved metadata.

Runtime tools, commands/hooks, Agent preset activation, MCP connections/discovery and effective session policies remain uninspected. Preserve these limits in the summary; never call a static pass a guarantee of successful execution or safety.

## Workflow

- Report only; do not modify, move, disable or install audited plugins.
- Inspect the declared profile first. An empty result is incomplete, not proof of health.
- Offer one concrete next step per fatal finding; changing configuration remains the user's decision.
- Keep the summary short and include the report's coverage limits.
