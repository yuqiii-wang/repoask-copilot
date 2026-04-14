#!/usr/bin/env python3
"""
main.py — Production Support Main entry point (called by the VS Code extension).

Reads a pending plan JSON (produced by prod_support_tools.py build-plan),
executes all scan tasks via query_logs, and prints the keyword presence
distribution to stdout as JSON.

Internally delegates to ``query_logs.py`` via ``python -m scripts.query_logs``
so that relative imports within the scripts package resolve correctly.

Usage
-----
    python main.py --plan pending-plan.json [--out result.json] [--env .env]

Exit codes
----------
  0  results written successfully
  1  error (printed to stderr)
"""

import argparse
import os
import subprocess
import sys


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--plan", "-p", required=True, metavar="FILE",
                    help="Path to the pending plan JSON")
    ap.add_argument("--out", "-o", metavar="FILE",
                    help="Write result JSON to FILE instead of stdout")
    ap.add_argument("--env", metavar="FILE",
                    default=os.path.join(os.path.dirname(__file__), ".env"),
                    help="Path to .env credentials file (default: scripts/.env)")
    args = ap.parse_args()

    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    # Run as a package so relative imports inside scripts/ work correctly.
    parent_dir = os.path.dirname(scripts_dir)

    cmd = [
        sys.executable, "-m", "scripts.query_logs",
        "--plan", os.path.abspath(args.plan),
        "--env", os.path.abspath(args.env),
    ]
    if args.out:
        cmd += ["--out", os.path.abspath(args.out)]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=parent_dir)  # nosec B603

    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.returncode != 0:
        sys.exit(result.returncode)
    print(result.stdout, end="")


if __name__ == "__main__":
    main()

