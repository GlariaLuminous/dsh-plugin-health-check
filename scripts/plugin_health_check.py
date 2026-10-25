#!/usr/bin/env python3
"""plugin-health-check scanner.

Statically scans installed agent plugins (Claude Code / DSH-style layout) and
detects cross-plugin conflicts and per-plugin defects.

Rules:
  R1  duplicate MCP server names across plugins            -> fatal
  R2  declared MCP tool name > 56 chars (truncation risk)  -> high
  R3  duplicate slash command names across plugins         -> high
  R4  hook matcher "*" / multiple plugins hook same tool   -> medium
  R5  skill description trigger-word overlap               -> medium
  R6  two or more plugins in the same functional category  -> medium
  R7  plugin not updated in > 90 days (optional --online)  -> low
  R8  config format errors (.mcp.json/plugin.json/skills)  -> fatal
  R9  skill-description token budget pressure              -> high
  R10 overly broad permissions (bypassPermissions / "*")   -> security

Exit code: 0 = no fatal issues, 1 = fatal issues found, 2 = usage/IO error.
Pure stdlib. Python 3.8+.
"""

import argparse
import datetime
import json
import os
import re
import sys
import subprocess
import urllib.request
from collections import defaultdict

SEVERITY_ORDER = {"fatal": 0, "security": 1, "high": 2, "medium": 3, "low": 4, "info": 5}

# Rough token estimate: ~4 chars per token (English-biased heuristic).
CHARS_PER_TOKEN = 4
# Default description budget: Claude Code warns around ~2% of a 200k window
# dedicated to skill descriptions; use a conservative 15k-token ceiling.
DEFAULT_DESC_TOKEN_BUDGET = 15000
TOOL_NAME_SAFE_LEN = 56  # 64-char limit minus namespace headroom
STALE_DAYS = 90

CATEGORY_KEYWORDS = {
    "context/compression": ["compress", "compact", "context", "summarize", "condense", "prune"],
    "browser": ["browser", "playwright", "puppeteer", "screenshot", "webpage", "crawl"],
    "git": ["git", "commit", "pull request", "pr review", "branch"],
    "database": ["sql", "database", "postgres", "mysql", "mongo", "redis", "query"],
    "memory": ["memory", "remember", "checkpoint", "session", "handoff", "resume"],
    "filesystem": ["filesystem", "file read", "file write", "directory"],
    "search": ["search", "grep", "find", "lookup", "检索", "搜索"],
    "deploy": ["deploy", "publish", "release", "ci", "cd", "部署", "发布"],
}


class Finding:
    def __init__(self, rule, severity, message, plugins=None, hint=None):
        self.rule = rule
        self.severity = severity
        self.message = message
        self.plugins = plugins or []
        self.hint = hint

    def to_dict(self):
        return {
            "rule": self.rule,
            "severity": self.severity,
            "message": self.message,
            "plugins": self.plugins,
            "hint": self.hint,
        }


def _load_json(path):
    """Return (data, error). Never raises."""
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, "file not found"
    except json.JSONDecodeError as e:
        return None, "invalid JSON: %s" % e
    except OSError as e:
        return None, "read error: %s" % e


def _iter_plugin_dirs(root):
    """Yield (name, path) for each plugin directory under root.

    A directory counts as a plugin if it contains plugin.json, .mcp.json,
    a skills/ dir, a commands/ dir, or a hooks/ dir. If root itself looks
    like a plugin, yield it as the single entry.
    """
    markers = ("plugin.json", ".mcp.json", "skills", "commands", "hooks")

    def is_plugin(p):
        try:
            return any(os.path.exists(os.path.join(p, m)) for m in markers)
        except OSError:
            return False

    if is_plugin(root):
        yield os.path.basename(os.path.abspath(root)), root
        return
    try:
        entries = sorted(os.listdir(root))
    except OSError as e:
        raise IOError("cannot list %s: %s" % (root, e))
    for entry in entries:
        p = os.path.join(root, entry)
        if os.path.isdir(p) and is_plugin(p):
            yield entry, p


def _collect_plugin(name, path):
    """Extract declared capabilities of one plugin. Never raises."""
    p = {
        "name": name,
        "path": path,
        "mcp_servers": {},      # server_name -> {"tools": [...]}
        "commands": [],         # slash command names
        "skills": [],           # {"name", "description"}
        "hooks": [],            # {"event", "matcher"}
        "permissions": {},
        "errors": [],           # R8 findings material
        "raw_plugin_json": None,
    }

    pj_path = os.path.join(path, "plugin.json")
    if os.path.exists(pj_path):
        pj, err = _load_json(pj_path)
        if err:
            p["errors"].append("plugin.json: %s" % err)
        elif not isinstance(pj, dict):
            p["errors"].append("plugin.json: root must be an object")
        else:
            p["raw_plugin_json"] = pj
            if not pj.get("name"):
                p["errors"].append("plugin.json: missing required field 'name'")
            if not pj.get("version"):
                p["errors"].append("plugin.json: missing 'version' (may be hidden from loaders)")
            perms = pj.get("permissions")
            if isinstance(perms, dict):
                p["permissions"] = perms

    mcp_path = os.path.join(path, ".mcp.json")
    if os.path.exists(mcp_path):
        mcp, err = _load_json(mcp_path)
        if err:
            p["errors"].append(".mcp.json: %s" % err)
        elif not isinstance(mcp, dict):
            p["errors"].append(".mcp.json: root must be an object")
        elif "mcpServers" not in mcp:
            p["errors"].append(
                ".mcp.json: missing 'mcpServers' wrapper - MCP servers will be silently ignored")
        elif not isinstance(mcp["mcpServers"], dict):
            p["errors"].append(".mcp.json: 'mcpServers' must be an object")
        else:
            for srv, cfg in mcp["mcpServers"].items():
                tools = []
                if isinstance(cfg, dict) and isinstance(cfg.get("tools"), list):
                    tools = [str(t) for t in cfg["tools"]]
                p["mcp_servers"][srv] = {"tools": tools}

    skills_dir = os.path.join(path, "skills")
    if os.path.isdir(skills_dir):
        for item in sorted(os.listdir(skills_dir)):
            sdir = os.path.join(skills_dir, item)
            skill_md = os.path.join(sdir, "SKILL.md")
            if not os.path.isdir(sdir):
                continue
            if not os.path.exists(skill_md):
                p["errors"].append("skills/%s: missing SKILL.md" % item)
                continue
            desc = ""
            try:
                with open(skill_md, "r", encoding="utf-8", errors="replace") as f:
                    head = f.read(4000)
                m = re.search(r"^---\s*\n(.*?)\n---", head, re.S)
                fm = m.group(1) if m else head
                dm = re.search(r"^description:\s*(.+)$", fm, re.M)
                if dm:
                    desc = dm.group(1).strip().strip('"').strip("'")
            except OSError as e:
                p["errors"].append("skills/%s/SKILL.md: read error: %s" % (item, e))
            p["skills"].append({"name": item, "description": desc})

    commands_dir = os.path.join(path, "commands")
    if os.path.isdir(commands_dir):
        for item in sorted(os.listdir(commands_dir)):
            if item.endswith(".md"):
                p["commands"].append(item[:-3])

    hooks_path = os.path.join(path, "hooks", "hooks.json")
    if os.path.exists(hooks_path):
        hooks, err = _load_json(hooks_path)
        if err:
            p["errors"].append("hooks/hooks.json: %s" % err)
        else:
            events = hooks.get("hooks", hooks) if isinstance(hooks, dict) else {}
            if isinstance(events, dict):
                for event, entries in events.items():
                    if not isinstance(entries, list):
                        continue
                    for entry in entries:
                        matcher = "*"
                        if isinstance(entry, dict):
                            matcher = str(entry.get("matcher", "*"))
                        p["hooks"].append({"event": str(event), "matcher": matcher})
    return p


def _github_pushed_at(owner, repo):
    """Best-effort GitHub API lookup. Returns datetime or None. Never raises."""
    import datetime as _dt  # local alias
    url = "https://api.github.com/repos/%s/%s" % (owner, repo)
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "plugin-health-check",
        })
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ts = data.get("pushed_at")
        if not ts:
            return None
        return _dt.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=_dt.timezone.utc)
    except Exception:
        return None


def _desc_tokens(plugins):
    total = 0
    per_plugin = {}
    for p in plugins:
        t = sum(len(s["description"]) // CHARS_PER_TOKEN + 8 for s in p["skills"])
        per_plugin[p["name"]] = t
        total += t
    return total, per_plugin


def _category_of(text):
    text = (text or "").lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k in text for k in kws):
            return cat
    return None


def scan(root, desc_budget=DEFAULT_DESC_TOKEN_BUDGET, online=False,
         candidate=None):
    findings = []
    try:
        plugins = [_collect_plugin(n, p) for n, p in _iter_plugin_dirs(root)]
    except IOError as e:
        raise

    candidate_names = set()
    if candidate:
        cpath = os.path.abspath(candidate)
        if not os.path.isdir(cpath):
            raise IOError("candidate is not a directory: %s" % cpath)
        cname = os.path.basename(cpath)
        cplugin = _collect_plugin(cname, cpath)
        plugins.append(cplugin)
        candidate_names.add(cname)

    if not plugins:
        findings.append(Finding("R0", "info",
                                "no plugins found under %s" % root,
                                hint="point --root at your plugins directory"))
        return findings, []

    # R8: per-plugin config format errors
    for p in plugins:
        for err in p["errors"]:
            findings.append(Finding(
                "R8", "fatal", "%s: %s" % (p["name"], err), [p["name"]],
                "fix the config file; the plugin is partially or fully silent-broken"))

    # R1: duplicate MCP server names
    seen = defaultdict(list)
    for p in plugins:
        for srv in p["mcp_servers"]:
            seen[srv].append(p["name"])
    for srv, owners in seen.items():
        if len(owners) > 1:
            findings.append(Finding(
                "R1", "fatal",
                "MCP server '%s' defined by multiple plugins: %s - one will silently override the other"
                % (srv, ", ".join(owners)),
                owners, "rename the server in one plugin or disable one of them"))

    # R2: overly long declared tool names
    for p in plugins:
        for srv, cfg in p["mcp_servers"].items():
            for t in cfg["tools"]:
                full = "mcp__%s__%s" % (srv, t)
                if len(full) > TOOL_NAME_SAFE_LEN:
                    findings.append(Finding(
                        "R2", "high",
                        "%s: tool '%s' -> registered name '%s' is %d chars (> %d); "
                        "truncation may cause unknown-tool failures and name collisions"
                        % (p["name"], t, full, len(full), TOOL_NAME_SAFE_LEN),
                        [p["name"]], "shorten the MCP server key in the config"))

    # R3: duplicate slash commands
    cmd_seen = defaultdict(list)
    for p in plugins:
        for c in p["commands"]:
            cmd_seen[c].append(p["name"])
    for c, owners in cmd_seen.items():
        if len(owners) > 1:
            findings.append(Finding(
                "R3", "high",
                "slash command '/%s' claimed by multiple plugins: %s - behavior is undefined"
                % (c, ", ".join(owners)),
                owners, "disable one plugin or ask the author to namespace the command"))

    # R4: hook matcher width and overlap
    hook_key = defaultdict(list)
    TOOL_EVENTS = {"PreToolUse", "PostToolUse", "PermissionRequest"}
    for p in plugins:
        for h in p["hooks"]:
            # '*' is only suspicious on tool events; lifecycle events
            # (SessionStart, Stop, ...) have no tool to match against.
            if h["matcher"] in ("*", "") and h["event"] in TOOL_EVENTS:
                findings.append(Finding(
                    "R4", "medium",
                    "%s: hook on '%s' uses matcher '*' - intercepts every tool call, "
                    "high collision and side-effect risk" % (p["name"], h["event"]),
                    [p["name"]], "narrow the matcher, e.g. 'Write' or 'mcp__myname__.*'"))
            hook_key[(h["event"], h["matcher"])].append(p["name"])
    for (event, matcher), owners in hook_key.items():
        if len(set(owners)) > 1 and matcher not in ("*", ""):
            findings.append(Finding(
                "R4", "medium",
                "hooks from %s all match '%s' on event '%s' - they run in parallel and "
                "cannot see each other; a deny from any one wins"
                % (", ".join(sorted(set(owners))), matcher, event),
                sorted(set(owners)), "review whether these hooks conflict semantically"))

    # R5: skill description overlap (shared rare-ish trigger words)
    stop = {"the", "a", "an", "and", "or", "to", "of", "for", "when", "user",
            "use", "this", "that", "with", "from", "code", "help", "fix"}
    skill_words = []
    for p in plugins:
        for s in p["skills"]:
            words = {w for w in re.findall(r"[a-zA-Z一-鿿]{3,}", s["description"].lower())
                     if w not in stop}
            skill_words.append((p["name"], s["name"], words))
    reported = set()
    for i in range(len(skill_words)):
        for j in range(i + 1, len(skill_words)):
            pa, sa, wa = skill_words[i]
            pb, sb, wb = skill_words[j]
            if pa == pb or not wa or not wb:
                continue
            inter = wa & wb
            union = wa | wb
            if len(inter) >= 3 and len(inter) / max(len(union), 1) > 0.3:
                key = tuple(sorted([sa, sb]))
                if key in reported:
                    continue
                reported.add(key)
                findings.append(Finding(
                    "R5", "medium",
                    "skills '%s' (%s) and '%s' (%s) share trigger words %s - "
                    "the model may load the wrong skill or both"
                    % (sa, pa, sb, pb, ", ".join(sorted(inter)[:6])),
                    [pa, pb], "make descriptions more specific; avoid generic words"))

    # R6: same functional category in multiple plugins
    cat_seen = defaultdict(list)
    for p in plugins:
        text = " ".join([p["name"]] + [s["description"] for s in p["skills"]]
                        + list(p["mcp_servers"].keys()))
        cat = _category_of(text)
        if cat:
            cat_seen[cat].append(p["name"])
    for cat, owners in cat_seen.items():
        if len(set(owners)) > 1:
            findings.append(Finding(
                "R6", "medium",
                "category '%s' is served by multiple plugins: %s - overlapping tools cause "
                "model indecision and repeated confirmation prompts"
                % (cat, ", ".join(sorted(set(owners)))),
                sorted(set(owners)), "keep one entry point per capability"))

    # R7: stale upstream (optional, needs network + plugin.json 'repository')
    if online:
        for p in plugins:
            pj = p["raw_plugin_json"] or {}
            repo = pj.get("repository") or pj.get("repo") or ""
            m = re.search(r"github\.com[:/]+([\w.-]+)/([\w.-]+)", str(repo))
            if not m:
                continue
            pushed = _github_pushed_at(m.group(1), m.group(2).replace(".git", ""))
            if pushed is None:
                continue
            age = (datetime.datetime.now(datetime.timezone.utc) - pushed).days
            if age > STALE_DAYS:
                findings.append(Finding(
                    "R7", "low",
                    "%s: upstream repository %s/%s last updated %d days ago - "
                    "may drift out of sync with platform changes"
                    % (p["name"], m.group(1), m.group(2), age),
                    [p["name"]], "check open issues before relying on it"))

    # R9: description token budget
    total, per_plugin = _desc_tokens(plugins)
    if total > desc_budget:
        top = sorted(per_plugin.items(), key=lambda kv: -kv[1])[:3]
        findings.append(Finding(
            "R9", "high",
            "skill descriptions total ~%d tokens, over budget %d. Biggest: %s. "
            "Descriptions risk being silently dropped at session start"
            % (total, desc_budget, ", ".join("%s ~%d" % kv for kv in top)),
            [k for k, _ in top],
            "disable unused plugins or set disable-model-invocation on chatty skills"))
    elif total > desc_budget * 0.7:
        findings.append(Finding(
            "R9", "low",
            "skill descriptions total ~%d tokens (%d%% of budget %d) - approaching the limit"
            % (total, int(100 * total / desc_budget), desc_budget)))

    # R10: broad permissions
    for p in plugins:
        perms = p["permissions"]
        allow = perms.get("allow", [])
        if perms.get("bypassPermissions") is True:
            findings.append(Finding(
                "R10", "security",
                "%s: requests bypassPermissions - can act without any user confirmation"
                % p["name"], [p["name"]],
                "install only if you fully trust the author"))
        if "*" in allow or "Bash(*)" in allow:
            findings.append(Finding(
                "R10", "security",
                "%s: permission allow-list contains wildcard - effectively unrestricted tool use"
                % p["name"], [p["name"]],
                "prefer explicit tool allow-lists"))

    findings.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.rule))

    # Pre-install mode: keep only findings that involve the candidate.
    if candidate_names:
        filtered = []
        for f in findings:
            if any(n in candidate_names for n in f.plugins) or \
               any(n in f.message for n in candidate_names):
                filtered.append(f)
        findings = filtered
    return findings, plugins


def format_report(findings, plugins, root):
    lines = []
    lines.append("plugin-health-check report")
    lines.append("root: %s" % root)
    lines.append("plugins scanned: %d" % len(plugins))
    lines.append("")
    counts = defaultdict(int)
    for f in findings:
        counts[f.severity] += 1
    summary = ", ".join("%s: %d" % (s, counts[s]) for s in
                        ("fatal", "security", "high", "medium", "low", "info") if counts[s])
    lines.append("findings: %s" % (summary or "none"))
    lines.append("")
    for f in findings:
        lines.append("[%s] (%s) %s" % (f.severity.upper(), f.rule, f.message))
        if f.hint:
            lines.append("    -> %s" % f.hint)
    if counts["fatal"]:
        lines.append("")
        lines.append("RESULT: FAIL - fatal issues present, fix before relying on these plugins")
    else:
        lines.append("")
        lines.append("RESULT: PASS - no fatal issues")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Scan installed agent plugins for conflicts and defects.")
    ap.add_argument("--root", default=None,
                    help="plugins root dir, or a single plugin dir "
                         "(default: ~/.claude/plugins)")
    ap.add_argument("--json", action="store_true", help="emit JSON report")
    ap.add_argument("--desc-budget", type=int, default=DEFAULT_DESC_TOKEN_BUDGET,
                    help="skill-description token budget (default %(default)s)")
    ap.add_argument("--candidate", metavar="DIR",
                    help="pre-install check: only report conflicts this plugin "
                         "directory would introduce against the installed set")
    ap.add_argument("--online", action="store_true",
                    help="also query GitHub for upstream staleness (R7)")
    ap.add_argument("--host", choices=("legacy", "dsh"), default="legacy",
                    help="select the native DSH profile auditor or the original directory scanner")
    ap.add_argument("--profile", default="desktop", help="DSH profile name (default: desktop)")
    ap.add_argument("--dsh-home", help="DSH home directory (default: DSH_HOME or ~/.dsh)")
    ap.add_argument("--dsh-install", action="append", help="DSH installation directory; repeatable")
    ap.add_argument("--dsh-version", help="explicit DSH runtime version if discovery is unavailable")
    ap.add_argument("--patch", action="append", help="extra DSH invocation overlay; repeatable")
    args = ap.parse_args(argv)

    if args.host == "dsh":
        if args.root is not None:
            print("error: --root is for legacy scans; use --dsh-home and --profile for DSH", file=sys.stderr)
            return 2
        if args.online:
            print("error: --online is only supported by the legacy directory scanner", file=sys.stderr)
            return 2
        command = ["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "dsh_health_check.mjs"),
                   "--profile", args.profile]
        for flag, value in (("--dsh-home", args.dsh_home), ("--dsh-version", args.dsh_version),
                            ("--candidate", args.candidate)):
            if value is not None:
                command.extend([flag, value])
        for flag, values in (("--dsh-install", args.dsh_install), ("--patch", args.patch)):
            for value in values or []:
                command.extend([flag, value])
        if args.json:
            command.append("--json")
        try:
            return subprocess.call(command)
        except OSError:
            print("error: DSH mode requires Node.js 22+; run npm ci --ignore-scripts first", file=sys.stderr)
            return 2

    root = os.path.abspath(args.root or os.path.expanduser("~/.claude/plugins"))
    if not os.path.isdir(root):
        print("error: not a directory: %s" % root, file=sys.stderr)
        return 2

    try:
        findings, plugins = scan(root, desc_budget=args.desc_budget,
                                 online=args.online, candidate=args.candidate)
    except IOError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({
            "root": root,
            "plugin_count": len(plugins),
            "plugins": [p["name"] for p in plugins],
            "findings": [f.to_dict() for f in findings],
            "fatal_count": sum(1 for f in findings if f.severity == "fatal"),
        }, ensure_ascii=False, indent=2))
    else:
        print(format_report(findings, plugins, root))

    return 1 if any(f.severity == "fatal" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
