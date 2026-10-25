#!/usr/bin/env python3
"""Convenience launcher for the DSH-only Node.js profile auditor (Python 3.8+)."""

import json
import os
import shutil
import subprocess
import sys


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    node = shutil.which("node")
    entry = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dsh_health_check.mjs")
    try:
        if node is None:
            raise OSError("Node.js is not available")
        return subprocess.call([node, entry] + args)
    except OSError:
        message = "DSH checks require Node.js 22+ on PATH; run npm ci --ignore-scripts in the repository."
        if "--json" in args:
            print(json.dumps({"host": "dsh", "status": "error", "exit_code": 2, "message": message}))
        else:
            print("error: " + message, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
