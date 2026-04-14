"""Loki keyword search for query_logs.

Uses the Loki ``/loki/api/v1/query_range`` endpoint with a LogQL regex filter
(``|~ "(?i)<keyword>"``) to retrieve matching log entries.  Each returned log
line is parsed by ``_log_parser`` and summarised into event strings.
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from ._log_parser import parse_log_line, summarize_hits

_LOKI_LIMIT = 2000  # max entries returned per query


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _escape_logql_re(keyword: str) -> str:
    """Escape characters that are special in LogQL / RE2 regex."""
    return re.escape(keyword)


def _query_range(
    loki_url: str,
    logql: str,
    start_iso: str,
    end_iso: str,
    ca_bundle: Optional[str],
) -> List[str]:
    """Call ``/loki/api/v1/query_range`` and return a flat list of log line strings.

    Results are ordered ``forward`` (oldest first).  Returns an empty list on
    any error.
    """
    import ssl  # local import keeps module load fast

    params = urllib.parse.urlencode(
        {
            "query": logql,
            "start": start_iso,
            "end": end_iso,
            "limit": _LOKI_LIMIT,
            "direction": "forward",
        }
    )
    url = f"{loki_url.rstrip('/')}/loki/api/v1/query_range?{params}"

    ctx: Optional[ssl.SSLContext] = None
    if ca_bundle:
        ctx = ssl.create_default_context(cafile=ca_bundle)

    req = urllib.request.Request(url)
    req.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:  # nosec B310
            body = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(f"[query_logs] WARNING loki {url!r}: {exc}", file=sys.stderr)
        return []

    lines: List[str] = []
    for stream in body.get("data", {}).get("result", []):
        # Each value is [nanosecond_timestamp_str, log_line_str]
        for _ns_ts, line in stream.get("values", []):
            lines.append(line)
    return lines


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def search_loki(
    entry: Dict[str, Any],
    ca_bundle: Optional[str] = None,
) -> Dict[str, Any]:
    """Query a Loki plan entry for every keyword and return presence distribution.

    Parameters
    ----------
    entry:
        A single ``"loki"`` entry from ``plan["logs"]``:
        ``{"loki_url": "...", "stream_selector": "...", "start_iso": "...",
        "end_iso": "...", "keywords": [...]}``.
    ca_bundle:
        Optional path to a CA bundle PEM file for TLS verification.

    Returns
    -------
    dict::

        {
            "stream_selector": "{job=...,component=...}",
            "keywords": {
                "keyword1": ["2026-04-11T14:13:00Z [ERROR][OmsService]", ...],
                "keyword2": [],
            }
        }
    """
    loki_url = entry["loki_url"]
    stream_selector = entry["stream_selector"]
    start_iso = entry.get("start_iso", "")
    end_iso = entry.get("end_iso", "")
    keywords = entry.get("keywords", [])

    kw_results: Dict[str, List[str]] = {}
    for kw in keywords:
        logql = f'{stream_selector}|~"(?i){_escape_logql_re(kw)}"'
        lines = _query_range(loki_url, logql, start_iso, end_iso, ca_bundle)
        parsed = [p for line in lines if (p := parse_log_line(line)) is not None]
        kw_results[kw] = summarize_hits(parsed)

    return {"stream_selector": stream_selector, "keywords": kw_results}
