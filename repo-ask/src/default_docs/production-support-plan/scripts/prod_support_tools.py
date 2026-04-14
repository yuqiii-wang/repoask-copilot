#!/usr/bin/env python3
"""
prod_support_tools.py — CLI bridge for the production-support-plan skill.

Subcommands
-----------
fetch-logs   --env <env>
    List available logtail log files grouped by component prefix.
    Output: JSON array of {prefix, files, environment, base_url}.

get-time
    Return current UTC time in plan-compatible formats.
    Output: JSON {display, compact, iso8601}.

build-plan   --proposal <file>   --log-listing <file>
    Resolve an LLM-populated proposal template into concrete scan tasks.
    The proposal must have `proposed_keywords` (list) and `proposed_logs`
    (dict: prefix -> {}).  The log-listing is the output of fetch-logs.
    Output: JSON plan ready for main.py --plan.

Usage
-----
    python prod_support_tools.py fetch-logs --env local
    python prod_support_tools.py get-time
    python prod_support_tools.py build-plan --proposal proposal.json --log-listing log-listing.json

Credentials / TLS
-----------------
Set CA_BUNDLE (or add to scripts/.env) to the path of the logtail server's
self-signed certificate PEM:
    CA_BUNDLE=/path/to/dummy-data-for-test/certs/logtail.crt
"""

import argparse
import csv
import json
import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# .env loader (mirrors build_plan.py)
# ---------------------------------------------------------------------------

def _load_env_file(path: str) -> None:
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
# Inline helpers (avoids relative-import issues when run as __main__)
# ---------------------------------------------------------------------------

class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: List[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "a":
            for name, val in attrs:
                if name == "href" and val:
                    self.links.append(val)


def _make_ssl_ctx(ca_bundle: Optional[str]) -> Optional[ssl.SSLContext]:
    if ca_bundle:
        return ssl.create_default_context(cafile=ca_bundle)
    return None


def _load_csv(path: str) -> List[Dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="|"))


def _list_logtail_files(base_url: str, component: str, ca_bundle: Optional[str] = None) -> List[str]:
    url = f"{base_url.rstrip('/')}/{component}?list"
    ctx = _make_ssl_ctx(ca_bundle)
    try:
        with urllib.request.urlopen(url, context=ctx, timeout=10) as resp:  # nosec B310
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"[prod_support_tools] WARNING: could not list {url}: {exc}", file=sys.stderr)
        return []
    parser = _LinkParser()
    parser.feed(html)
    return parser.links


# ---------------------------------------------------------------------------
# subcommand: fetch-logs
# ---------------------------------------------------------------------------

def cmd_fetch_logs(env: str) -> None:
    ca_bundle: Optional[str] = os.environ.get("CA_BUNDLE", "").strip() or None
    rows = _load_csv(os.path.join(os.path.dirname(__file__), "logs.csv"))
    result: List[Dict[str, Any]] = []

    for row in rows:
        if row.get("environment", "").strip() != env:
            continue
        if row.get("type", "").strip() != "logtail":
            continue
        base_url = row["base_url"].strip()
        tags = [t.strip() for t in row.get("tags", "").split(",") if t.strip()]
        for tag in tags:
            files = _list_logtail_files(base_url, tag, ca_bundle=ca_bundle)
            if files:
                result.append({
                    "prefix": tag,
                    "files": files,
                    "environment": env,
                    "base_url": base_url,
                })

    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# subcommand: get-time
# ---------------------------------------------------------------------------

def cmd_get_time() -> None:
    now = datetime.now(timezone.utc)
    print(json.dumps({
        "display":  now.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "compact":  now.strftime("%Y%m%d%H%M%S"),
        "iso8601":  now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }))


# ---------------------------------------------------------------------------
# subcommand: build-plan
# ---------------------------------------------------------------------------

def _parse_compact_ts(ts: Optional[str]) -> Optional[datetime]:
    """Parse YYYYMMDDHHmmss (14-digit) or ISO-8601 timestamp, return UTC datetime."""
    if not ts:
        return None
    ts = str(ts).strip()
    # 14-digit compact
    if re.fullmatch(r"\d{14}", ts):
        try:
            return datetime.strptime(ts, "%Y%m%d%H%M%S")
        except ValueError:
            return None
    # YYYY-MM-DD HH:MM:SS[.mmm]
    ts_no_ms = ts.split(".")[0].replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(ts_no_ms, fmt)
        except ValueError:
            continue
    return None


def _parse_filename_ts(filename: str) -> Optional[datetime]:
    m = re.search(r"(\d{17})", filename)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1)[:14], "%Y%m%d%H%M%S")
    except ValueError:
        return None


def cmd_build_plan(proposal_path: str, log_listing_path: str) -> None:
    with open(proposal_path, encoding="utf-8") as fh:
        proposal: Dict[str, Any] = json.load(fh)
    with open(log_listing_path, encoding="utf-8") as fh:
        log_listing: List[Dict[str, Any]] = json.load(fh)

    ca_bundle: Optional[str] = os.environ.get("CA_BUNDLE", "").strip() or None

    # Build index: prefix -> list of file URLs
    listing_index: Dict[str, List[str]] = {}
    for entry in log_listing:
        prefix = entry.get("prefix", "")
        if prefix:
            listing_index[prefix] = entry.get("files", [])

    # Determine time window
    incident_ts = _parse_compact_ts(proposal.get("incident_time"))
    now = datetime.utcnow()
    if incident_ts:
        window_start = incident_ts - timedelta(hours=3)
        window_end   = incident_ts + timedelta(hours=1)
    else:
        window_end   = now
        window_start = now - timedelta(hours=6)

    lookback_cutoff = window_start - timedelta(hours=3)  # extra buffer for rolling files

    keywords: List[str] = proposal.get("proposed_keywords", [])
    scan_tasks: List[Dict[str, Any]] = []

    for prefix in proposal.get("proposed_logs", {}).keys():
        file_urls = listing_index.get(prefix, [])
        for url in file_urls:
            m = re.search(r"[?&]file=([^&]+)", url)
            filename = m.group(1) if m else url.rsplit("/", 1)[-1]

            file_ts = _parse_filename_ts(filename)
            if file_ts is not None:
                if file_ts > window_end:
                    continue
                if file_ts < lookback_cutoff:
                    continue

            scan_tasks.append({
                "type": "logtail",
                "url": url,
                "time_range": {
                    "start": window_start.strftime("%Y-%m-%d %H:%M:%S.000"),
                    "end":   window_end.strftime("%Y-%m-%d %H:%M:%S.999"),
                },
                "keywords": keywords,
            })

    plan = {
        "original_query":      proposal.get("original_query", ""),
        "incident_summary":    proposal.get("incident_summary", ""),
        "environment":         proposal.get("environment", "local"),
        "incident_time":       proposal.get("incident_time"),
        "extracted_identifiers": proposal.get("extracted_identifiers", []),
        "keywords":            keywords,
        "scan_tasks":          scan_tasks,
        "extra": {
            "CA_BUNDLE": ca_bundle or "",
        },
    }

    print(json.dumps(plan, indent=2))


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_fetch = sub.add_parser("fetch-logs", help="List available log files by prefix")
    p_fetch.add_argument("--env", default="local", help="Environment name (default: local)")

    sub.add_parser("get-time", help="Return current UTC time in plan-compatible formats")

    p_build = sub.add_parser("build-plan", help="Resolve a proposal into scan tasks")
    p_build.add_argument("--proposal",    required=True, metavar="FILE")
    p_build.add_argument("--log-listing", required=True, metavar="FILE")

    args = ap.parse_args()

    if args.cmd == "fetch-logs":
        cmd_fetch_logs(args.env)
    elif args.cmd == "get-time":
        cmd_get_time()
    elif args.cmd == "build-plan":
        cmd_build_plan(args.proposal, args.log_listing)


if __name__ == "__main__":
    main()
