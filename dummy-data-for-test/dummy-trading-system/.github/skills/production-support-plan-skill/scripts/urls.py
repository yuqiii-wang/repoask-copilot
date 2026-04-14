#!/usr/bin/env python3
"""
urls.py — Discover available production log files by querying the logtail server.

Config is read from data/logs.csv (pipe-delimited: environment|base_url|prefix|summary).
Credentials (LOG_API_KEY, LOG_USERNAME, LOG_PASSWORD) are loaded from .env — see .env.example.

Call list_log_descriptions(env) to get each known log prefix, its summary,
and all timestamped files currently available on the server.
Use this in Step 1 of the plan before handing off to production-support-main.
"""

import argparse
import csv
import os
import re
import sys
import urllib.request
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"
_ENV_FILE = Path(__file__).parent / ".env"


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def _load_env() -> None:
    """Load variables from .env into os.environ (no-op if file is absent)."""
    if not _ENV_FILE.exists():
        return
    with _ENV_FILE.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())


def _build_opener() -> urllib.request.OpenerDirector:
    """Return an opener with Basic auth and/or Bearer token when credentials are set."""
    username = os.environ.get("LOG_USERNAME", "")
    password = os.environ.get("LOG_PASSWORD", "")
    api_key  = os.environ.get("LOG_API_KEY", "")

    handlers: list = []
    if username and password:
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, "", username, password)
        handlers.append(urllib.request.HTTPBasicAuthHandler(mgr))

    opener = urllib.request.build_opener(*handlers)
    if api_key:
        opener.addheaders.append(("Authorization", f"Bearer {api_key}"))
    return opener


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _parse_config(env: str) -> tuple[str, dict[str, str]]:
    """
    Read data/logs.csv and return (base_url, {prefix: summary}) for *env*.
    Raises KeyError if no rows match the requested environment.
    """
    base_url = ""
    log_entries: dict[str, str] = {}

    with (_DATA_DIR / "logs.csv").open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="|"):
            if row["environment"].strip().lower() != env:
                continue
            base_url = row["base_url"].strip()
            log_entries[row["prefix"].strip()] = row["summary"].strip()

    if not base_url:
        raise KeyError(f"Unknown environment {env!r}. Check data/logs.csv.")
    return base_url, log_entries


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_log_descriptions(env: str = "local") -> list[dict]:
    """
    Query the logtail server and return one entry per known log prefix
    with its summary and all timestamped files currently available.

    For each prefix, calls ``{base_url}/{prefix}?list`` to discover files.

    Returns list of:
        {
          "prefix": str,
          "summary": str,
          "available": [{"timestamp": str, "url": str}, ...]
        }

    "available" is sorted by timestamp ascending; empty list means the
    prefix is configured but no matching file exists on the server yet.
    """
    _load_env()
    base, log_entries = _parse_config(env.lower().strip())

    opener = _build_opener()
    ts_re = re.compile(r"^(.+)-(\d{17})\.log$")

    result: list[dict] = []
    for prefix in sorted(log_entries):
        list_url = f"{base}/{prefix}?list"
        try:
            with opener.open(list_url, timeout=5) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        except OSError as exc:
            print(f"WARN: could not reach {list_url!r}: {exc}", file=sys.stderr)
            result.append({"prefix": prefix, "summary": log_entries[prefix], "available": []})
            continue

        available: list[dict] = []
        for url in re.findall(r'href="([^"]+)"', html):
            m = ts_re.search(url)
            if m and m.group(1).endswith(prefix):
                available.append({"timestamp": m.group(2), "url": url})

        result.append({
            "prefix":    prefix,
            "summary":   log_entries[prefix],
            "available": sorted(available, key=lambda x: x["timestamp"]),
        })

    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="List available production log files for a given environment."
    )
    parser.add_argument(
        "--env", default="local",
        help="Target environment (default: local)"
    )
    args = parser.parse_args()
    try:
        result = list_log_descriptions(env=args.env)
        print(json.dumps(result, indent=2))
    except KeyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print(f"ERROR: could not reach logtail server — {exc}", file=sys.stderr)
        sys.exit(2)
