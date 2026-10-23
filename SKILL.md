---
name: plugin-health-check
description: Audit installed agent plugins for conflicts and defects, and pre-check a plugin before installing it. Use when the user wants to install a new plugin ("install plugin X", "帮我装这个插件"), asks to check/audit/clean up installed plugins ("检查我的插件", "插件冲突", "插件体检"), or experiences weird agent behavior after installing plugins (repeated confirmation prompts, wrong skill loading, commands not working, MCP tools failing).
---

# Plugin Health Check

Users install plugins impulsively and pay the price later: silent conflicts,
duplicated capabilities, broken configs, bloated context. This skill turns the
community's manual "disable half and bisect" debugging into an automated audit.

## Two modes

### Mode A: Full audit (default)

Run when the user asks to check their installed plugins:

```bash
python scripts/plugin_health_check.py --root <plugins_root>
```

- Default root is `~/.claude/plugins`; for WorkBuddy/DSH ask the user or use
  the host's plugin directory if known.
- Add `--online` to also check upstream repos for staleness (needs network).
- Add `--json` for machine-readable output.

### Mode B: Pre-install check

Run when the user is about to install a new plugin. Obtain the plugin source
first (clone/download it to a temp dir), then:

```bash
python scripts/plugin_health_check.py --root <plugins_root> --candidate <plugin_dir>
```

Only findings involving the candidate are reported. Present them as:
**safe to install / install with caution / do not install**, with reasons.

## Interpreting findings

| Rule | Severity | Meaning |
|------|----------|---------|
| R1 | fatal | Two plugins define the same MCP server name — one silently wins |
| R2 | high | Tool name too long — truncation causes unknown-tool failures |
| R3 | high | Two plugins claim the same slash command |
| R4 | medium | Hook matcher too wide, or multiple plugins hook the same tool |
| R5 | medium | Skill descriptions overlap — model loads wrong/duplicate skills |
| R6 | medium | Multiple plugins serve the same capability — model indecision |
| R7 | low | Plugin not updated in 90+ days |
| R8 | fatal | Config format error — plugin is silently (partially) broken |
| R9 | high | Skill descriptions exceed token budget — descriptions get dropped |
| R10 | security | Plugin requests bypassPermissions or wildcard allow-list |

Severity guide for the final answer to the user:

- **fatal / security** findings → tell the user explicitly what breaks or what
  trust is required; recommend disabling or fixing before continuing.
- **high** → recommend action, explain the concrete failure it prevents.
- **medium / low** → list as suggestions; do not alarm.

## Workflow rules

1. Never modify, move, or disable plugins yourself. Report only; the user decides.
2. If `--root` has no plugins, say so and ask for the correct directory instead
   of guessing common paths repeatedly.
3. After the report, offer one concrete next step per fatal/high finding
   (e.g. "disable plugin Y to resolve R1") but wait for confirmation.
4. Keep the user-facing summary short: counts by severity, then the top
   findings. Point to the full report for details.
