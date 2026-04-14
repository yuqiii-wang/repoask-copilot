#!/usr/bin/env python3
"""
build_plan.py — Resolve a search template into a concrete execution plan.

Reads logs.csv to discover available log sources, then for each source entry
in the template:

  logtail  Fetches {base_url}/{component}?list, parses the HTML file list,
           filters log files whose 17-digit filename timestamp overlaps the
           incident time window, and emits one plan entry per qualifying file.

  loki     Builds a LogQL stream selector from the component tag and emits
           one plan entry covering the full time window.

Usage
-----
    python scripts/build_plan.py --template template.json [--out plan.json]
    python scripts/build_plan.py < template.json            # stdin
    python scripts/build_plan.py --help

Exit codes
----------
  0  plan written successfully
  1  error (printed to stderr)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from ._csv_utils import find_loki_row, find_logtail_row, load_csv
from ._logtail import DEFAULT_LOOKBACK_HOURS, resolve_logtail
from ._loki import resolve_loki
from ._timestamps import parse_ts, to_logtail_ts


# ---------------------------------------------------------------------------
# .env loader
# ---------------------------------------------------------------------------

def _load_env_file(path: str) -> None:
    """Load KEY=VALUE pairs from a .env file into os.environ (no override)."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


_ENV_FILE = os.path.join(os.path.dirname(__file__), ".env")
_load_env_file(_ENV_FILE)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_CSV = os.path.join(os.path.dirname(__file__), "logs.csv")

# ---------------------------------------------------------------------------
# build_plan
# ---------------------------------------------------------------------------


def build_plan(template: Dict[str, Any], csv_path: str = DEFAULT_CSV) -> Dict[str, Any]:
    """
    Resolve a template dict into a concrete plan dict.

    Parameters
    ----------
    template : dict
        Parsed JSON template produced by the production-support-plan AI skill.
    csv_path : str
        Path to the logs.csv file that maps environments/types/tags to base URLs.

    Returns
    -------
    dict
        Resolved plan ready for production-support-main / main.py.
    """
    rows = load_csv(csv_path)
    env = template.get("environment", "local")
    sources = template.get("sources", [])

    # Collect all keywords across sources for the top-level field.
    all_keywords: List[str] = []
    for src in sources:
        for kw in src.get("keywords", []):
            if kw not in all_keywords:
                all_keywords.append(kw)

    # Determine the global time window (union over all sources).
    global_start: Optional[datetime] = None
    global_end: Optional[datetime] = None
    for src in sources:
        s = parse_ts(src.get("start_time", ""))
        e = parse_ts(src.get("end_time", ""))
        if s:
            global_start = s if global_start is None else min(global_start, s)
        if e:
            global_end = e if global_end is None else max(global_end, e)

    if global_start is None:
        global_start = datetime.utcnow() - timedelta(hours=DEFAULT_LOOKBACK_HOURS)
    if global_end is None:
        global_end = global_start + timedelta(hours=DEFAULT_LOOKBACK_HOURS + 1)

    logs: List[Dict[str, Any]] = []

    for src in sources:
        src_type = src.get("type", "")
        tags = src.get("tags", [])
        if not tags:
            print(f"[build_plan] WARNING: source has no tags, skipping: {src}", file=sys.stderr)
            continue

        # Per-source window (falls back to global window).
        start = parse_ts(src.get("start_time", "")) or global_start
        end = parse_ts(src.get("end_time", "")) or global_end

        ca_bundle = os.environ.get("CA_BUNDLE", "").strip() or None

        if src_type == "logtail":
            for tag in tags:
                row = find_logtail_row(rows, env, tag)
                if row is None:
                    print(
                        f"[build_plan] WARNING: no logs.csv logtail entry for "
                        f"env={env} tag={tag}",
                        file=sys.stderr,
                    )
                    continue
                logs.extend(resolve_logtail(row, {**src, "tags": [tag]}, start, end, ca_bundle=ca_bundle))

        elif src_type == "loki":
            # One Loki server per environment; tags = component labels to query.
            row = find_loki_row(rows, env)
            if row is None:
                print(
                    f"[build_plan] WARNING: no logs.csv loki entry for env={env}",
                    file=sys.stderr,
                )
            else:
                logs.extend(resolve_loki(row, src, start, end))

        else:
            print(f"[build_plan] WARNING: unknown source type '{src_type}'", file=sys.stderr)

    return {
        "incident_summary": template.get("incident_summary", ""),
        "environment": env,
        "original_query": template.get("original_query", ""),
        "incident_time": template.get("incident_time"),
        "time_range": {
            "start": to_logtail_ts(global_start),
            "end": to_logtail_ts(global_end),
        },
        "extracted_identifiers": template.get("extracted_identifiers", []),
        "keywords": all_keywords,
        "logs": logs,
        "extra": {
            "CA_BUNDLE": os.environ.get("CA_BUNDLE", "").strip(),
        },
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--template", "-t",
        metavar="FILE",
        help="Path to template JSON (default: read from stdin)",
    )
    ap.add_argument(
        "--out", "-o",
        metavar="FILE",
        help="Write resolved plan JSON to FILE instead of stdout",
    )
    ap.add_argument(
        "--csv",
        metavar="FILE",
        default=DEFAULT_CSV,
        help=f"Override path to logs.csv (default: {DEFAULT_CSV})",
    )
    args = ap.parse_args()

    # Load template -----------------------------------------------------------
    if args.template:
        try:
            with open(args.template, encoding="utf-8") as fh:
                template = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[build_plan] ERROR: could not read template: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        if sys.stdin.isatty():
            ap.print_help()
            print(
                "\n[build_plan] ERROR: no --template provided and stdin is a terminal.",
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            template = json.load(sys.stdin)
        except json.JSONDecodeError as exc:
            print(f"[build_plan] ERROR: invalid JSON on stdin: {exc}", file=sys.stderr)
            sys.exit(1)

    # Resolve -----------------------------------------------------------------
    try:
        plan = build_plan(template, csv_path=args.csv)
    except FileNotFoundError as exc:
        print(f"[build_plan] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    # Output ------------------------------------------------------------------
    out_text = json.dumps(plan, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(out_text)
        print(f"[build_plan] Plan written to {args.out} ({len(plan['logs'])} log entries)", file=sys.stderr)
    else:
        print(out_text)


if __name__ == "__main__":
    main()
