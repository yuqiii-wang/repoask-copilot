#!/usr/bin/env python3
"""
prod_support_tools.py — Unified CLI for production-support plan tools.

Subcommands
-----------
  fetch-logs  --env <env>
      Discover available log files from the logtail server.
      Output: JSON array (same as urls.list_log_descriptions)

  build-plan  --proposal <path>  --log-listing <path>  [--source-dir <path>]
      Assemble the full scan-plan JSON from an LLM proposal + log listing.
      Output: full plan JSON with scan_tasks

All output is printed to stdout. Warnings go to stderr.
"""

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).parent


# ---------------------------------------------------------------------------
# Module loader (avoids sys.path manipulation)
# ---------------------------------------------------------------------------

def _load(name: str, filename: str):
    path = _HERE / filename
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {filename} from {_HERE}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def _get_time(_args: argparse.Namespace) -> None:
    """Print the current UTC time in both compact and ISO-8601 formats."""
    now = datetime.now(timezone.utc)
    print(json.dumps({
        "compact": now.strftime("%Y%m%d%H%M"),
        "iso8601": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "display": now.strftime("%Y-%m-%d %H:%M UTC"),
    }))


def _fetch_logs(args: argparse.Namespace) -> None:
    """Call urls.list_log_descriptions and print as JSON."""
    urls = _load("urls", "urls.py")
    try:
        result = urls.list_log_descriptions(env=args.env)
    except KeyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print(f"ERROR: could not reach logtail server — {exc}", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(result, indent=2, ensure_ascii=False))


def _build_plan(args: argparse.Namespace) -> None:
    """Load proposal + listing files, delegate to build_plan.build_plan, print JSON."""
    build_plan = _load("build_plan", "build_plan.py")
    try:
        proposal = json.loads(Path(args.proposal).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"ERROR reading proposal file: {exc}", file=sys.stderr)
        sys.exit(1)
    try:
        listing = json.loads(Path(args.log_listing).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"ERROR reading log-listing file: {exc}", file=sys.stderr)
        sys.exit(1)

    plan = build_plan.build_plan(proposal, listing, args.source_dir)
    print(json.dumps(plan, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="prod_support_tools",
        description="Production-support plan helper tools.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # get-time
    sub.add_parser("get-time", help="Return current UTC time in compact and ISO-8601 formats")

    # fetch-logs
    p_logs = sub.add_parser("fetch-logs", help="Discover available log files")
    p_logs.add_argument("--env", default="local",
                        help="Target environment key (default: local)")

    # build-plan
    p_plan = sub.add_parser("build-plan", help="Build scan plan from LLM proposal")
    p_plan.add_argument("--proposal",    required=True,
                        help="Path to LLM proposal JSON file")
    p_plan.add_argument("--log-listing", required=True,
                        help="Path to available log listing JSON file (from fetch-logs)")
    p_plan.add_argument("--source-dir",  default=None,
                        help="Optional project source root for keyword validation")

    return p


def main() -> None:
    args = _build_parser().parse_args()
    if args.cmd == "get-time":
        _get_time(args)
    elif args.cmd == "fetch-logs":
        _fetch_logs(args)
    elif args.cmd == "build-plan":
        _build_plan(args)


if __name__ == "__main__":
    main()
