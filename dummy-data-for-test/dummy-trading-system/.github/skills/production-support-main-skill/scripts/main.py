#!/usr/bin/env python3
"""
main.py — Async production log scanner (the ONLY runnable script in this skill).

Takes a scan plan produced by production-support-plan and runs all log ×
time-range combinations in one async task pool, returning a merged JSON map
of log_name -> keyword -> [timestamp, ...] for every match.
No sensitive data is sent to any remote LLM.  Only static keyword strings
and the returned timestamp hit-list are produced; all log content stays
server-side.

Scanning Modes
--------------
  1. Logtail mode (default): Query individual log files via logtail server
  2. Loki mode (--loki): Query Loki log aggregation system with LogQL

Plan mode (recommended)
-----------------------
Pass the full scan plan from production-support-plan as --plan.  Each entry
in plan["scan_tasks"] carries its own log_url, words, and time_ranges, so
different logs can be searched for different terms simultaneously.

    python scripts/main.py --plan plan.json [--seed] [--pretty] [--raw] \
                            [--round N] [--max-rounds M]

    # Use Loki instead of logtail server
    python scripts/main.py --plan plan.json --loki [--loki-url http://localhost:8094]

`--round N` (default 1) and `--max-rounds M` (default 5) track the current
iteration of the LLM think-scan-think loop.  main.py emits "Round N/M" on
stderr and adds a ``_meta`` key to the JSON output:

    {"_meta": {"round": N, "max_rounds": M, "budget_remaining": M-N}, ...}

When ``budget_remaining == 0`` the LLM must not start another round.

The plan JSON structure is:

    {
      "incident_summary": "...",
      "original_query": "...",
      "extracted_identifiers": ["US0378331005"],
      "scan_tasks": [
        {
          "log_url": "http://host/api/logs/trading-system-202604011300.log",
          "words": ["/orders/", "fill", "routing"],
          "time_ranges": [{"start": "2026-04-01 09:00:00.000",
                           "end":   "2026-04-01 13:00:00.000"}]
        }
      ]
    }

main.py validates every extracted_identifier against original_query
(injection guard), applies guess_pattern() to convert raw tokens into safe
regexes, and merges the results into a dict grouped by log file name: log_name -> keyword -> [timestamps].

Flat mode (fallback)
--------------------
For ad-hoc use without a plan file, pass --log-urls, --words, and
--start-time/--end-time (or --time-ranges).  All logs share the same keyword
list and time windows.

    python scripts/main.py \\
        --log-urls http://127.0.0.1:8093/api/logs/trading-system-202604011300.log \\
        --start-time "2026-04-01 09:00:00.000" \\
        --end-time   "2026-04-01 13:00:00.000" \\
        --words error timeout --seed

Environment variables
---------------------
    LOG_SCANNER_TOKEN      Optional Bearer token for the logtail service
    LOKI_AUTH_TOKEN        Optional Bearer token for Loki API
"""

import argparse
import asyncio
import json
import sys

try:
    import httpx  # noqa: F401 — imported here so the error message is user-friendly
except ImportError:
    print("ERROR: 'httpx' is required. Install with:  pip install httpx", file=sys.stderr)
    sys.exit(2)

from utils import (
    build_tasks_from_args,
    build_tasks_from_plan,
    merge_hits,
    scan_all,
)


def is_unified_plan(plan: dict) -> bool:
    """
    Check if the plan uses the unified query format.
    
    Unified format has stream selectors as keys (e.g., '{job="app-logs",component="trading-system"}')
    and contains a _meta key with mode information.
    
    Traditional format has scan_tasks, incident_summary, etc.
    """
    if not isinstance(plan, dict):
        return False
    
    # Check for _meta with mode field
    meta = plan.get("_meta")
    if meta and isinstance(meta, dict) and "mode" in meta:
        # Look for stream selector format in keys
        for key in plan.keys():
            if key == "_meta":
                continue
            # Check if key looks like a Loki selector or component name
            if '{' in key or 'component' in key.lower():
                return True
    
    return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Async production log keyword scanner.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # --- Plan mode -----------------------------------------------------------
    p.add_argument(
        "--plan",
        default=None,
        metavar="JSON_OR_FILE",
        help=(
            "Scan plan produced by production-support-plan.  Accepts either a "
            "file path (plan.json) or an inline JSON string.  When provided, "
            "--log-urls / --time-ranges / --words are ignored."
        ),
    )

    # --- Flat mode (fallback) ------------------------------------------------
    p.add_argument(
        "--log-urls",
        nargs="+",
        default=[],
        metavar="URL",
        help="(Flat mode) Pre-resolved log file URLs",
    )
    p.add_argument(
        "--start-time",
        default=None,
        help='(Flat mode) Single-range start  e.g. "2026-04-01 09:00:00.000"',
    )
    p.add_argument(
        "--end-time",
        default=None,
        help='(Flat mode) Single-range end    e.g. "2026-04-01 17:00:00.000"',
    )
    p.add_argument(
        "--time-ranges",
        default=None,
        metavar="JSON",
        help=(
            '(Flat mode) JSON array of {"start": "...", "end": "..."} objects. '
            'Example: \'[{"start": "2026-04-01 09:00:00.000", "end": "2026-04-01 12:00:00.000"}]\''
        ),
    )
    p.add_argument(
        "--original-query",
        default="",
        metavar="TEXT",
        help="Raw user query text (validates --tokenized-query tokens)",
    )
    p.add_argument(
        "--tokenized-query",
        nargs="+",
        default=[],
        metavar="TOKEN",
        help=(
            "Sensitive tokens extracted from the user query "
            "(e.g. ISINs, order IDs). Each must appear in --original-query."
        ),
    )
    p.add_argument(
        "--words",
        nargs="+",
        default=[],
        metavar="KW",
        help="Static keyword strings / safe regex patterns to search for",
    )
    p.add_argument(
        "--seed",
        action="store_true",
        help="Prepend COMMON_ERROR_WORDS to every task's keyword list",
    )
    p.add_argument(
        "--query",
        default="",
        help="(Flat mode) Free-text query to auto-tokenize into keywords",
    )
    p.add_argument(
        "--pretty",
        action="store_true",
        default=True,
        help="Pretty-print JSON output (default: True)",
    )
    p.add_argument(
        "--source-dir",
        default=None,
        metavar="DIR",
        help=(
            "Project source directory scanned for log/exception/route literals. "
            "When provided, proposed keywords not traceable to the user query "
            "or source code are dropped before scanning."
        ),
    )
    p.add_argument(
        "--raw",
        action="store_true",
        help="Emit one JSON object per task instead of a merged hit-list",
    )

    # --- Iterative-investigation round tracking ------------------------------
    p.add_argument(
        "--round",
        type=int,
        default=1,
        metavar="N",
        help="Current investigation round (1-based).  Emitted in _meta.",
    )
    p.add_argument(
        "--max-rounds",
        type=int,
        default=5,
        metavar="M",
        help="Maximum number of scan-and-think rounds allowed (default: 5).",
    )
    
    # --- Loki mode ------------------------------------------------------------
    p.add_argument(
        "--loki",
        action="store_true",
        help="Use Loki API instead of logtail server for log queries",
    )
    p.add_argument(
        "--loki-url",
        default="http://localhost:8094",
        metavar="URL",
        help="Loki server base URL (default: http://localhost:8094)",
    )
    
    return p


def main() -> None:
    args = _build_parser().parse_args()

    # ------------------------------------------------------------------
    # Build task list — plan mode OR flat mode
    # ------------------------------------------------------------------
    plan: dict | None = None
    
    # Determine if using Loki mode
    use_loki = args.loki
    
    if args.plan:
        plan_text = args.plan
        try:
            if not plan_text.lstrip().startswith("{"):
                with open(plan_text, encoding="utf-8") as fh:
                    plan_text = fh.read()
            plan = json.loads(plan_text)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"ERROR: could not load --plan: {exc}", file=sys.stderr)
            sys.exit(1)

        # Check if this is a unified plan format
        if is_unified_plan(plan):
            from query_builders import (
                build_loki_queries,
                build_logtail_queries,
                optimize_loki_queries,
            )
            
            current_round = max(1, args.round)
            max_rounds = max(1, args.max_rounds)
            budget_remaining = max(0, max_rounds - current_round)
            
            # Detect mode from plan or override with --loki flag
            plan_mode = plan.get("_meta", {}).get("mode", "logtail")
            if use_loki:
                plan_mode = "loki"
            
            if plan_mode == "loki":
                # Build and optimize Loki queries
                loki_queries = build_loki_queries(plan, base_url=args.loki_url)
                optimized_queries = optimize_loki_queries(loki_queries)
                
                print(
                    f"Round {current_round}/{max_rounds} (Loki unified format) — "
                    f"Executing {len(optimized_queries)} optimized LogQL query(ies) ...",
                    file=sys.stderr,
                )
                
                # Log queries in structured format for UI display
                print("QUERIES_START", file=sys.stderr)
                query_info = {
                    "backend": "loki",
                    "base_url": args.loki_url,
                    "queries": [
                        {
                            "logql": q.logql,
                            "start_time": q.start_time,
                            "end_time": q.end_time,
                            "description": q.description
                        }
                        for q in optimized_queries
                    ]
                }
                print(json.dumps(query_info), file=sys.stderr)
                print("QUERIES_END", file=sys.stderr)
                
                # Execute queries using Loki scanner
                from loki_scanner import scan_loki_unified
                results = asyncio.run(scan_loki_unified(optimized_queries, loki_url=args.loki_url))
                
            else:
                # Build Logtail queries
                logtail_queries = build_logtail_queries(plan)
                
                print(
                    f"Round {current_round}/{max_rounds} (Logtail unified format) — "
                    f"Executing {len(logtail_queries)} HTTP query(ies) ...",
                    file=sys.stderr,
                )
                
                # Log queries in structured format for UI display
                print("QUERIES_START", file=sys.stderr)
                query_info = {
                    "backend": "logtail",
                    "queries": [
                        {
                            "url": q.url,
                            "component": q.component,
                            "description": q.description
                        }
                        for q in logtail_queries
                    ]
                }
                print(json.dumps(query_info), file=sys.stderr)
                print("QUERIES_END", file=sys.stderr)
                
                # Execute queries using standard scanner
                from utils import scan_logtail_unified
                results = asyncio.run(scan_logtail_unified(logtail_queries))
            
            if budget_remaining == 0:
                print(
                    "Max rounds reached. No further iterations will be started.",
                    file=sys.stderr,
                )
            
            meta = {
                "_meta": {
                    "round": current_round,
                    "max_rounds": max_rounds,
                    "budget_remaining": budget_remaining,
                    "mode": plan_mode,
                }
            }
            
            indent = 2 if args.pretty else None
            print(json.dumps({**meta, **results}, indent=indent))
            return
        
        if use_loki:
            # Use Loki scanner
            from loki_scanner import build_loki_tasks_from_plan, scan_loki_all, merge_loki_hits
            
            loki_tasks = build_loki_tasks_from_plan(plan, loki_url=args.loki_url)
            if not loki_tasks:
                print("ERROR: plan contains no valid Loki scan tasks.", file=sys.stderr)
                sys.exit(1)
            
            current_round = max(1, args.round)
            max_rounds = max(1, args.max_rounds)
            budget_remaining = max(0, max_rounds - current_round)
            
            print(
                f"Round {current_round}/{max_rounds} (Loki mode) — "
                f"Scanning {len(loki_tasks)} stream(s) ...",
                file=sys.stderr,
            )
            
            # Log queries in structured format for UI display
            print("QUERIES_START", file=sys.stderr)
            query_info = {
                "backend": "loki",
                "base_url": args.loki_url,
                "queries": [
                    {
                        "stream_selector": task.stream_selector,
                        "start_time": task.start_iso,
                        "end_time": task.end_iso,
                        "keywords": task.keywords
                    }
                    for task in loki_tasks
                ]
            }
            print(json.dumps(query_info), file=sys.stderr)
            print("QUERIES_END", file=sys.stderr)
            
            if budget_remaining == 0:
                print(
                    "Max rounds reached. No further iterations will be started.",
                    file=sys.stderr,
                )
            
            results = asyncio.run(scan_loki_all(loki_tasks))
            merged = merge_loki_hits(results)
            
            meta = {
                "_meta": {
                    "round": current_round,
                    "max_rounds": max_rounds,
                    "budget_remaining": budget_remaining,
                    "mode": "loki",
                }
            }
            
            indent = 2 if args.pretty else None
            print(json.dumps({**meta, **merged}, indent=indent))
            return
        else:
            # Use logtail scanner
            tasks = build_tasks_from_plan(plan, seed=args.seed, source_dir=args.source_dir)
            if not tasks:
                print("ERROR: plan contains no scan_tasks.", file=sys.stderr)
                sys.exit(1)
    else:
        if not args.log_urls:
            print(
                "ERROR: provide --plan (plan mode) or --log-urls (flat mode).",
                file=sys.stderr,
            )
            sys.exit(1)
        if not args.start_time and not args.end_time and not args.time_ranges:
            print(
                "ERROR: provide --start-time/--end-time or --time-ranges.",
                file=sys.stderr,
            )
            sys.exit(1)

        tasks = build_tasks_from_args(
            log_urls=args.log_urls,
            words=args.words,
            tokenized_query_tokens=args.tokenized_query,
            original_query=args.original_query,
            seed=args.seed,
            query=args.query,
            time_ranges_json=args.time_ranges,
            start_time=args.start_time,
            end_time=args.end_time,
            source_dir=args.source_dir,
        )

        if not any(t.words for t in tasks):
            print(
                "ERROR: no keywords to search for. "
                "Pass --words, --seed, or --query.",
                file=sys.stderr,
            )
            sys.exit(1)

    current_round = max(1, args.round)
    max_rounds = max(1, args.max_rounds)
    budget_remaining = max(0, max_rounds - current_round)

    unique_logs = len({t.log_url for t in tasks})
    print(
        f"Round {current_round}/{max_rounds} — "
        f"Scanning {unique_logs} log(s), {len(tasks)} parallel task(s) ...",
        file=sys.stderr,
    )
    if budget_remaining == 0:
        print(
            "Max rounds reached. No further iterations will be started.",
            file=sys.stderr,
        )

    results = asyncio.run(scan_all(tasks))

    indent = 2 if args.pretty else None

    meta = {
        "_meta": {
            "round": current_round,
            "max_rounds": max_rounds,
            "budget_remaining": budget_remaining,
        }
    }

    if args.raw:
        print(json.dumps({**meta, "tasks": results}, indent=indent))
    else:
        merged = merge_hits(results)
        print(json.dumps({**meta, **merged}, indent=indent))

    if all("_error" in v for v in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()

