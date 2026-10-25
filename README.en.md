<p align="center">
  <img src="assets/hero.svg" width="860" alt="plugin-health-check — a shield with a checkmark; tagline: Audit your agent plugins before they audit you. Badges: R1 conflict, R9 budget risk, 10 rules 0 deps.">
</p>

<p align="center">
  <strong>Plugin conflict auditor for agent ecosystems.</strong><br>
  Pre-install checks and full audits for Claude Code / DSH / WorkBuddy-style plugins.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#what-it-catches">Rules</a> •
  <a href="#two-modes">Modes</a> •
  <a href="#why-this-exists">Why</a> •
  <a href="README.md">中文文档</a>
</p>

<p align="center">
  <a href="https://github.com/GlariaLuminous/plugin-health-check/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/python-3.8%2B-3776AB.svg?logo=python&logoColor=white" alt="Python 3.8+">
  <img src="https://img.shields.io/badge/legacy_dependencies-0-brightgreen.svg" alt="Legacy mode has zero dependencies; DSH uses Node.js packages">
  <img src="https://img.shields.io/badge/rules-10-8b5cf6.svg" alt="10 detection rules">
  <img src="https://img.shields.io/badge/tests-DSH%20%2B%20legacy-brightgreen.svg" alt="DSH and legacy regression suites">
</p>

---

**Everyone installs plugins on impulse. Nobody checks what conflicts with what — until something silently breaks.**

Two MCP servers expose a tool with the same name, and *every request* starts failing with a 400. A plugin ships a malformed `.mcp.json`, and its servers are *silently ignored forever*. Two context-compression plugins both do their job, and together they *delete the context you needed*.

The community's answer today is "disable half your plugins and bisect." This skill turns that into one command.

## Native DSH mode

Audit DSH profiles, selected bundles and effective patches. Requires Node.js 22+; the Python wrapper also requires Python 3.8+.

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
cd plugin-health-check
npm ci --ignore-scripts
node scripts/dsh_health_check.mjs --profile desktop --json
# Equivalent Python entry:
python scripts/plugin_health_check.py --host dsh --profile desktop --json
```

Supports scoped packages, Desktop ASAR installations, DSH engine/peer compatibility and exact exemptions, ordered Cordis patches, disabled groups, static includes, basic MCP configuration and local candidate comparisons. Add `--candidate /path/to/package` to compare an update without executing or installing it.

Home defaults to `DSH_HOME` or `~/.dsh`. `--dsh-install` supplies an installation directory containing `node_modules`; `--dsh-version` supplies a runtime version when automatic detection is unavailable.

Exit codes: **0** static checks passed, **1** fatal findings, **2** input/setup error, **3** incomplete. Reports expose resolved bundle counts and unknown coverage. Expressions and plugin code never execute. Runtime tools, commands, hooks, Agent presets, MCP discovery and effective session permissions remain uninspected. The legacy R2/R9/R10 assumptions below do not apply to DSH. See [DSH usage and scope](docs/dsh.md).

## Quick Start

The original directory scanner still works with Python 3.8+ and no third-party dependencies. The R1–R10 rules below describe this legacy mode; use the native entry above for DSH:

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
python plugin-health-check/scripts/plugin_health_check.py --root ~/.claude/plugins
```

Or install it as a skill so your agent runs the audit for you:

```bash
cp -r plugin-health-check ~/.claude/skills/plugin-health-check
```

Then just say: *"检查一下我的插件"* / *"audit my plugins"* — or, before installing something new: *"看看这个插件能不能装"*.

<p align="center">
  <img src="assets/demo.svg" width="860" alt="Terminal demo: scanning 8 plugins finds 1 fatal (R1 duplicate MCP server 'filesystem' shared by fs-mcp and file-tools), 1 high (R3 duplicate /review command), 2 medium. Verdict line: RESULT: FAIL - fix before relying on these plugins.">
</p>

## Two Modes

| You want to… | Run |
|---|---|
| Audit everything installed | `python scripts/plugin_health_check.py --root <plugins_dir>` |
| Check a plugin **before** installing it | `... --root <plugins_dir> --candidate <plugin_dir>` |
| Get machine-readable output (CI gates) | `... --json` |
| Also check upstream repos for staleness | `... --online` |

Exit codes: `0` clean · `1` fatal findings (gate your CI on it) · `2` usage error.

## What It Catches

Ten rules, each distilled from a real, documented incident:

| Rule | Severity | Catches | Real-world origin |
|---|---|---|---|
| **R1** | 🔴 fatal | Duplicate MCP server names across plugins | One silently overrides the other |
| **R2** | 🟠 high | Tool names that collide after 64-char truncation | [openworker #746](https://github.com/andrewyng/openworker/issues/746) — 9 of 31 tools collided |
| **R3** | 🟠 high | Two plugins claiming the same slash command | Undefined behavior on invoke |
| **R4** | 🟡 medium | Wildcard `*` hooks on tool events; parallel hooks on one tool | Double side-effects, silent denys |
| **R5** | 🟡 medium | Overlapping skill trigger words | Model loads the wrong skill — or both |
| **R6** | 🟡 medium | Multiple plugins serving the same capability | Model indecision, repeated confirmation prompts |
| **R7** | ⚪ low | Upstream repo untouched for 90+ days (`--online`) | Drift from platform changes |
| **R8** | 🔴 fatal | Config format errors: missing `mcpServers` wrapper, broken JSON, missing SKILL.md | The Context7 silent-failure pattern |
| **R9** | 🟠 high | Skill descriptions exceeding the prompt budget | Vercel plugin: 126 skills → 371 descriptions dropped |
| **R10** | 🟣 security | `bypassPermissions` or wildcard allow-lists | Acts without ever asking you |

## Design Principles

- **Reports, never touches.** The scanner is read-only. It will not disable, move, or "fix" anything — you decide.
- **Zero dependencies in legacy mode.** DSH mode uses the official Cordis patch algorithm and pinned YAML/SemVer packages.
- **No false alarms on lifecycle hooks.** `*` matchers on `SessionStart`/`Stop` are legitimate — only tool events get flagged.
- **The rule library is a living asset.** R1–R10 come from real GitHub issues. New incident patterns become new rules.

## Honest Limitations

- Static analysis only: it reads declared configs, so MCP tool-name collisions (R2) are caught when plugins declare their tools — runtime-discovered tools are out of scope.
- R5's overlap detection is keyword-based heuristics, not embeddings. It trades a little noise for zero cost and zero network.
- R7 requires `--online` and reads only public GitHub metadata.

A tool that can say "you're fine" is one you can trust when it says you're not.

## Project Layout

```
plugin-health-check/
├── SKILL.md                       # agent skill definition (triggers + workflow)
├── scripts/
│   └── plugin_health_check.py     # the scanner: CLI + importable
├── tests/
│   └── run_tests.py               # 23-assertion suite, self-built fixtures
├── assets/                        # hero + demo SVGs
└── README.md (中文) / README.en.md (English)
```

## Contributing

The highest-value contribution is a **new rule**: if you hit a plugin-conflict incident in the wild that R1–R10 don't catch, open an issue with the failure mode — that's how this library grows.

```bash
python tests/run_tests.py   # passed: 23, failed: 0
npm test                   # DSH regression suite
```

## License

[MIT](LICENSE) — audit freely, ship confidently.
