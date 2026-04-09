#!/usr/bin/env python3
"""
build_plan.py — Deterministic scan-plan JSON builder.

Reads an LLM keyword/log proposal and an available-log listing produced by
urls.py, then assembles the full scan_tasks plan JSON consumed by main.py.

Arguments
---------
  --proposal     <path>   LLM proposal JSON (proposed_keywords + proposed_logs)
  --log-listing  <path>   Available log listing JSON (output of urls.py)
  --source-dir   <path>   Optional: project source root for keyword validation

Output
------
  Full plan JSON printed to stdout.  Warnings go to stderr.
"""

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _time_range_for_ts(ts: str, before_minutes: int = 120, after_minutes: int = 60) -> dict:
    """Return a time_range covering *before_minutes* before to *after_minutes* after *ts* (YYYYMMDDHHmm)."""
    try:
        dt = datetime.strptime(ts, "%Y%m%d%H%M")
        start = dt - timedelta(minutes=before_minutes)
        end   = dt + timedelta(minutes=after_minutes) - timedelta(milliseconds=1)
        return {
            "start": start.strftime("%Y-%m-%d %H:%M:%S.000"),
            "end":   end.strftime("%Y-%m-%d %H:%M:%S.") + f"{end.microsecond // 1000:03d}",
        }
    except ValueError:
        return {"start": "2000-01-01 00:00:00.000", "end": "2099-12-31 23:59:59.999"}


def _time_range_now(lookback_minutes: int = 120) -> dict:
    """Return a time_range covering the last *lookback_minutes* up to now (UTC)."""
    now = datetime.utcnow().replace(microsecond=0)
    start = now - timedelta(minutes=lookback_minutes)
    return {
        "start": start.strftime("%Y-%m-%d %H:%M:%S.000"),
        "end":   now.strftime("%Y-%m-%d %H:%M:%S.999"),
    }


_TS_PARSE_FMTS = [
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
]


def _normalize_ts(ts: str, is_end: bool = False) -> str | None:
    """
    Parse *ts* with any recognised format and return it in the canonical
    'YYYY-MM-DD HH:MM:SS.mmm' format expected by the logtail server.
    Returns None if the string cannot be parsed.
    """
    for fmt in _TS_PARSE_FMTS:
        try:
            dt = datetime.strptime(ts.strip(), fmt)
            ms = dt.microsecond // 1000
            return dt.strftime("%Y-%m-%d %H:%M:%S.") + f"{ms:03d}"
        except ValueError:
            continue
    return None

def _load_keyword_filter():
    """Dynamically load keyword_filter from the same directory (avoid import issues)."""
    here = Path(__file__).parent
    spec = importlib.util.spec_from_file_location("keyword_filter", here / "keyword_filter.py")
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

def build_plan(proposal: dict, listing: list, source_dir: str | None = None) -> dict:
    """
    Assemble the full scan plan from the LLM proposal and the server log listing.

    Parameters
    ----------
    proposal    : dict  parsed LLM proposal JSON
    listing     : list  parsed available-log listing from urls.py
    source_dir  : str   optional path to project source root for keyword validation
    """
    keywords: list[str] = list(proposal.get("proposed_keywords", []))

    # incident_time: compact YYYYMMDDHHmm timestamp from the query (may be None/"null")
    _incident_time_raw = proposal.get("incident_time")
    incident_time: str | None = (
        None if not _incident_time_raw or str(_incident_time_raw).lower() in ("null", "none", "")
        else str(_incident_time_raw).strip()
    )

    # proposed_logs can be:
    #   new format – dict  {prefix: {category: {start, end}, ...}}
    #   old format – list  [prefix, ...]
    _raw_logs = proposal.get("proposed_logs", {})
    if isinstance(_raw_logs, list):
        proposed_logs_map: dict = {p: {} for p in _raw_logs}
    elif isinstance(_raw_logs, dict):
        proposed_logs_map = _raw_logs
    else:
        proposed_logs_map = {}

    # ── Optional keyword validation via keyword_filter ───────────────────────
    if source_dir:
        mod = _load_keyword_filter()
        if mod is not None:
            try:
                kept, dropped = mod.filter_keywords(
                    keywords,
                    proposal.get("original_query", ""),
                    source_dir,
                )
                if dropped:
                    print(
                        f"Warning: removed unverifiable keywords: {dropped}",
                        file=sys.stderr,
                    )
                keywords = kept
            except Exception as exc:
                print(f"Warning: keyword_filter skipped ({exc})", file=sys.stderr)
        else:
            print("Warning: keyword_filter.py not found — skipping validation", file=sys.stderr)

    # ── Index listing by prefix ───────────────────────────────────────────────
    listing_index: dict[str, list[dict]] = {
        e["prefix"]: e.get("available", []) for e in listing
    }

    # ── Assemble scan_tasks ───────────────────────────────────────────────────
    scan_tasks: list[dict] = []
    for prefix, time_map in proposed_logs_map.items():
        available = listing_index.get(prefix, [])
        if not available:
            print(
                f"Warning: no available log files for prefix '{prefix}'",
                file=sys.stderr,
            )
            continue
        # Collect explicit time ranges from the category map (skip template placeholders)
        explicit_ranges = []
        if isinstance(time_map, dict):
            for cat_range in time_map.values():
                if not isinstance(cat_range, dict):
                    continue
                start = cat_range.get("start") or None
                end   = cat_range.get("end")   or None
                # Skip null entries and template placeholders — incident_time / now fallback handles these
                if not start or not end:
                    continue
                if "<<" in str(start) or "<<" in str(end):
                    continue
                # Normalize to canonical 'YYYY-MM-DD HH:MM:SS.mmm' format
                norm_start = _normalize_ts(str(start))
                norm_end   = _normalize_ts(str(end))
                if not norm_start or not norm_end:
                    print(
                        f"WARN: unrecognised timestamp format for prefix '{prefix}': "
                        f"start={start!r} end={end!r} — skipping, using incident_time/now fallback",
                        file=sys.stderr,
                    )
                    continue
                explicit_ranges.append({"start": norm_start, "end": norm_end})
        for entry in available:
            if explicit_ranges:
                time_ranges = explicit_ranges
            elif incident_time:
                # Use the user-supplied incident timestamp as the scan window
                time_ranges = [_time_range_for_ts(incident_time)]
            else:
                # No time mentioned in the query — scan the 2-hour window ending now
                time_ranges = [_time_range_now(lookback_minutes=120)]
            scan_tasks.append(
                {
                    "log_url": entry["url"],
                    "words": keywords,
                    "time_ranges": time_ranges,
                }
            )

    return {
        "incident_summary":      proposal.get("incident_summary", ""),
        "environment":           proposal.get("environment", "local"),
        "original_query":        proposal.get("original_query", ""),
        "incident_time":         incident_time,
        "extracted_identifiers": proposal.get("extracted_identifiers", []),
        "proposed_keywords":     keywords,
        "proposed_logs":         proposed_logs_map,
        "scan_tasks":            scan_tasks,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Build scan plan JSON from LLM proposal and available log listing."
    )
    p.add_argument("--proposal",    required=True, help="Path to LLM proposal JSON file")
    p.add_argument("--log-listing", required=True, help="Path to available log listing JSON file")
    p.add_argument("--source-dir",  default=None,  help="Project source root for keyword validation")
    return p


def main() -> None:
    args = _build_parser().parse_args()

    try:
        proposal = json.loads(Path(args.proposal).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Error reading proposal file: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        listing = json.loads(Path(args.log_listing).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Error reading log listing file: {exc}", file=sys.stderr)
        sys.exit(1)

    plan = build_plan(proposal, listing, args.source_dir)
    print(json.dumps(plan, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
