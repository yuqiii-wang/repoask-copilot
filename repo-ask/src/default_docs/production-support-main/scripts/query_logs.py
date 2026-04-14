#!/usr/bin/env python3
"""
query_logs.py — Execute a resolved plan JSON and return keyword presence distributions.

Reads the plan produced by ``build_plan.py``, queries every logtail file and
Loki stream listed in ``plan["logs"]`` for the associated keywords, and outputs
a JSON array where each element represents one log source with a
``keyword → [event-strings]`` presence map.

Privacy
-------
Only timestamps, log levels, and class names are returned.  Raw log message
content is deliberately stripped to respect data-access restrictions.

Usage
-----
    # Run as a package from the skill root directory:
    python -m scripts.query_logs --plan plan.json [--out result.json]

    # Or pipe a plan from another command:
    python -m scripts.build_plan --template template.json | python -m scripts.query_logs

Credentials
-----------
Set the following environment variables (or add them to ``scripts/.env``):

    LOG_API_KEY    → adds ``Authorization: Bearer <key>``  to logtail requests
    LOG_USERNAME   → used with LOG_PASSWORD for HTTP Basic auth (fallback)
    LOG_PASSWORD
    CA_BUNDLE      → path to a PEM CA bundle for internal HTTPS servers

Exit codes
----------
  0  results written successfully
  1  error (printed to stderr)
"""

import argparse
import base64
import json
import os
import sys
from typing import Any, Dict, List, Optional

from ._logtail_query import search_logtail
from ._loki_query import search_loki


# ---------------------------------------------------------------------------
# .env loader
# ---------------------------------------------------------------------------

def _load_env_file(path: str) -> None:
    """Load ``KEY=VALUE`` pairs from a .env file into ``os.environ`` (no override)."""
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


# ---------------------------------------------------------------------------
# Auth / TLS helpers
# ---------------------------------------------------------------------------

def _build_auth_headers() -> Optional[Dict[str, str]]:
    """Build HTTP auth headers from environment variables, or return ``None``."""
    api_key = os.environ.get("LOG_API_KEY", "").strip()
    if api_key:
        return {"Authorization": f"Bearer {api_key}"}

    username = os.environ.get("LOG_USERNAME", "").strip()
    password = os.environ.get("LOG_PASSWORD", "").strip()
    if username and password:
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        return {"Authorization": f"Basic {token}"}

    return None


def _resolve_ca_bundle(plan: Dict[str, Any]) -> Optional[str]:
    """Return the CA bundle path from ``plan["extra"]`` or ``CA_BUNDLE`` env var."""
    bundle = plan.get("extra", {}).get("CA_BUNDLE", "").strip()
    if not bundle:
        bundle = os.environ.get("CA_BUNDLE", "").strip()
    return bundle or None


# ---------------------------------------------------------------------------
# Core execution
# ---------------------------------------------------------------------------

def run_query(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Execute all log searches described in *plan* and return results list.

    Accepts both ``logs`` (native field) and ``scan_tasks`` (prod_support_tools
    field name) so that ``main.py`` can pass pending-plan.json directly.
    """
    ca_bundle = _resolve_ca_bundle(plan)
    auth_headers = _build_auth_headers()

    # Accept either the native 'logs' key or the 'scan_tasks' key from prod_support_tools.
    log_entries = plan.get("logs") or plan.get("scan_tasks", [])

    results: List[Dict[str, Any]] = []
    for entry in log_entries:
        entry_type = entry.get("type", "")
        if entry_type == "logtail":
            results.append(
                search_logtail(entry, auth_headers=auth_headers, ca_bundle=ca_bundle)
            )
        elif entry_type == "loki":
            results.append(search_loki(entry, ca_bundle=ca_bundle))
        else:
            print(
                f"[query_logs] WARNING: unknown log type '{entry_type}', skipping",
                file=sys.stderr,
            )

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--plan", "-p",
        metavar="FILE",
        help="Path to resolved plan JSON (default: read from stdin)",
    )
    ap.add_argument(
        "--out", "-o",
        metavar="FILE",
        help="Write result JSON to FILE instead of stdout",
    )
    ap.add_argument(
        "--env",
        metavar="FILE",
        default=os.path.join(os.path.dirname(__file__), ".env"),
        help="Path to .env credentials file (default: scripts/.env)",
    )
    args = ap.parse_args()

    _load_env_file(args.env)

    # Load plan -----------------------------------------------------------
    if args.plan:
        try:
            with open(args.plan, encoding="utf-8") as fh:
                plan = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[query_logs] ERROR: could not read plan: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        if sys.stdin.isatty():
            ap.print_help()
            print(
                "\n[query_logs] ERROR: no --plan provided and stdin is a terminal.",
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            plan = json.load(sys.stdin)
        except json.JSONDecodeError as exc:
            print(f"[query_logs] ERROR: invalid JSON on stdin: {exc}", file=sys.stderr)
            sys.exit(1)

    # Execute -------------------------------------------------------------
    results = run_query(plan)

    # Output --------------------------------------------------------------
    out_text = json.dumps(results, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(out_text)
        print(
            f"[query_logs] Results written to {args.out} ({len(results)} sources queried)",
            file=sys.stderr,
        )
    else:
        print(out_text)


if __name__ == "__main__":
    main()
