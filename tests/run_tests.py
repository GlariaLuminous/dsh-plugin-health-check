#!/usr/bin/env python3
"""Test suite for plugin_health_check.py. Builds fixture plugins in a temp
dir and asserts findings. Run: python tests/run_tests.py  (exit 0 = all pass)
"""

import importlib.util
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "phc", os.path.join(HERE, "..", "scripts", "plugin_health_check.py"))
phc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(phc)

PASSED, FAILED = 0, 0


def check(label, cond, extra=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print("  PASS %s" % label)
    else:
        FAILED += 1
        print("  FAIL %s  %s" % (label, extra))


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = "w"
    with open(path, mode, encoding="utf-8") as f:
        f.write(content if isinstance(content, str) else json.dumps(content))


def skill(root, plugin, name, desc):
    write(os.path.join(root, plugin, "skills", name, "SKILL.md"),
          "---\nname: %s\ndescription: %s\n---\n\nbody\n" % (name, desc))


def build_fixtures(root):
    # plugin-alpha: wildcard hook, bypassPermissions, dup MCP server, dup command
    write(os.path.join(root, "plugin-alpha", "plugin.json"), {
        "name": "plugin-alpha", "version": "1.0.0",
        "permissions": {"bypassPermissions": True}})
    write(os.path.join(root, "plugin-alpha", ".mcp.json"),
          {"mcpServers": {"shared-fs": {"command": "npx", "args": ["fs-mcp"]}}})
    write(os.path.join(root, "plugin-alpha", "commands", "review.md"), "# review\n")
    write(os.path.join(root, "plugin-alpha", "hooks", "hooks.json"),
          {"hooks": {"PreToolUse": [{"matcher": "*", "hooks": []}]}})
    skill(root, "plugin-alpha", "ctx-saver",
          "Save and compact conversation context into memory checkpoints for session resume")

    # plugin-beta: same MCP server, same command, broken .mcp.json not needed here;
    # long tool name; overlapping skill description
    write(os.path.join(root, "plugin-beta", "plugin.json"), {
        "name": "plugin-beta", "version": "0.2.0"})
    write(os.path.join(root, "plugin-beta", ".mcp.json"), {"mcpServers": {
        "shared-fs": {"command": "node", "args": ["other.js"]},
        "hub-gmail-thresholdstack": {"command": "x", "tools": [
            "gmail-thresholdstack__get_gmail_message_content_extra_long"]}}})
    write(os.path.join(root, "plugin-beta", "commands", "review.md"), "# review2\n")
    skill(root, "plugin-beta", "memory-keeper",
          "Compact conversation context into memory checkpoints and resume sessions")

    # plugin-broken: .mcp.json missing mcpServers wrapper; skill missing SKILL.md
    write(os.path.join(root, "plugin-broken", "plugin.json"),
          {"name": "plugin-broken"})
    write(os.path.join(root, "plugin-broken", ".mcp.json"),
          {"some-server": {"command": "npx"}})
    os.makedirs(os.path.join(root, "plugin-broken", "skills", "ghost"), exist_ok=True)

    # plugin-badjson: invalid plugin.json
    write(os.path.join(root, "plugin-badjson", "plugin.json"), "{not json")
    write(os.path.join(root, "plugin-badjson", "commands", "x.md"), "# x\n")

    # plugin-clean: no issues expected
    write(os.path.join(root, "plugin-clean", "plugin.json"),
          {"name": "plugin-clean", "version": "2.1.0"})
    skill(root, "plugin-clean", "pdf-tools",
          "Extract tables and text from PDF documents")


def rules(findings):
    return {(f.rule, f.severity) for f in findings}


def main():
    tmp = tempfile.mkdtemp(prefix="phc-test-")
    try:
        build_fixtures(tmp)

        print("[1] full audit on fixtures")
        findings, plugins = phc.scan(tmp)
        r = rules(findings)
        check("5 plugins discovered", len(plugins) == 5, "got %d" % len(plugins))
        check("R1 duplicate MCP server (fatal)", ("R1", "fatal") in r)
        check("R2 long tool name (high)", ("R2", "high") in r)
        check("R3 duplicate command (high)", ("R3", "high") in r)
        check("R4 wildcard hook (medium)", ("R4", "medium") in r)
        check("R5 skill overlap (medium)", ("R5", "medium") in r)
        check("R6 same category memory (medium)", ("R6", "medium") in r)
        check("R8 broken .mcp.json (fatal)", ("R8", "fatal") in r)
        check("R8 missing version flagged",
              any(f.rule == "R8" and "version" in f.message for f in findings))
        check("R8 bad JSON flagged",
              any(f.rule == "R8" and "invalid JSON" in f.message for f in findings))
        check("R8 missing SKILL.md flagged",
              any(f.rule == "R8" and "SKILL.md" in f.message for f in findings))
        check("R10 bypassPermissions (security)", ("R10", "security") in r)
        check("exit-worthy fatal present",
              any(f.severity == "fatal" for f in findings))

        print("[2] clean-only audit passes")
        clean = os.path.join(tmp, "cleanroot")
        os.makedirs(clean)
        shutil.copytree(os.path.join(tmp, "plugin-clean"),
                        os.path.join(clean, "plugin-clean"))
        f2, p2 = phc.scan(clean)
        check("no fatal in clean root",
              not any(f.severity == "fatal" for f in f2),
              str([f.message for f in f2]))
        check("1 plugin discovered", len(p2) == 1)

        print("[3] candidate (pre-install) mode")
        cand = os.path.join(tmp, "candidate")
        write(os.path.join(cand, "plugin.json"),
              {"name": "candidate", "version": "1.0.0"})
        write(os.path.join(cand, ".mcp.json"),
              {"mcpServers": {"shared-fs": {"command": "npx"}}})
        write(os.path.join(cand, "commands", "deploy.md"), "# deploy\n")
        f3, _ = phc.scan(tmp, candidate=cand)  # tmp has alpha/beta with 'shared-fs'
        check("candidate R1 conflict detected", any(
            f.rule == "R1" and "candidate" in f.plugins for f in f3),
            str([f.to_dict() for f in f3]))
        check("candidate mode filters unrelated findings",
              all("candidate" in f.plugins or "candidate" in f.message for f in f3))
        f4, _ = phc.scan(clean, candidate=os.path.join(clean, "plugin-clean"))
        # candidate identical to installed clean plugin: no new conflicts
        check("clean candidate -> no fatal",
              not any(f.severity == "fatal" for f in f4))

        print("[4] abnormal input handling")
        os.makedirs(os.path.join(tmp, "empty-dir"), exist_ok=True)
        f5, p5 = phc.scan(os.path.join(tmp, "empty-dir"))
        check("empty dir -> R0 info, no crash",
              len(p5) == 0 and any(f.rule == "R0" for f in f5))
        rc = phc.main(["--root", os.path.join(tmp, "nope")])
        check("missing root -> exit 2", rc == 2, "got %s" % rc)
        rc = phc.main(["--root", tmp, "--json"])
        check("json mode exit 1 on fatal", rc == 1, "got %s" % rc)
        rc = phc.main(["--root", clean])
        check("clean root -> exit 0", rc == 0, "got %s" % rc)

        print("[5] desc budget rule")
        big = os.path.join(tmp, "bigroot")
        os.makedirs(big)
        for i in range(30):
            write(os.path.join(big, "p%02d" % i, "plugin.json"),
                  {"name": "p%02d" % i, "version": "1.0"})
            skill(big, "p%02d" % i, "s%d" % i, "x" * 400 + " unique%d" % i)
        f6, _ = phc.scan(big, desc_budget=1000)
        check("R9 over budget (high)", ("R9", "high") in rules(f6))

        print()
        print("passed: %d, failed: %d" % (PASSED, FAILED))
        return 0 if FAILED == 0 else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
