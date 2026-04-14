"""Logtail keyword search for query_logs.

For each keyword the logtail server is queried with a time-window filter
(``&f=HH:MM&t=HH:MM``) plus an include filter (``&i=<keyword>``), so only
matching lines are transferred.  The response is plain text; each line is
parsed by ``_log_parser`` and the results are summarised into event strings.
"""

import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional

from ._log_parser import parse_log_line, summarize_hits


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ts_to_hhmm(ts_str: str) -> Optional[str]:
    """Convert ``"YYYY-MM-DD HH:MM:SS.mmm"`` or ``"YYYY-MM-DDTHH:MM:SSZ"`` to ``"HH:MM"``.

    Returns ``None`` if the string cannot be parsed.
    """
    ts_str = ts_str.strip().replace("T", " ").replace("Z", "")
    # Strip sub-second precision before parsing.
    ts_str = ts_str.split(".")[0]
    try:
        dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        return dt.strftime("%H:%M")
    except ValueError:
        return None


def _build_query_url(base_url: str, keyword: str, time_range: Dict[str, str]) -> str:
    """Append ``?f=HH:MM&t=HH:MM&i=<keyword>`` params to the logtail file URL."""
    params: List[str] = []
    f = _ts_to_hhmm(time_range.get("start", ""))
    t = _ts_to_hhmm(time_range.get("end", ""))
    if f:
        params.append("f=" + f)
    if t:
        params.append("t=" + t)
    params.append("i=" + urllib.parse.quote(keyword, safe=""))
    sep = "&" if "?" in base_url else "?"
    return base_url + sep + "&".join(params)


def _fetch_lines(
    url: str,
    auth_headers: Optional[Dict[str, str]],
    ca_bundle: Optional[str],
) -> List[str]:
    """GET *url* and return the response body split into lines.

    Returns an empty list on any network or HTTP error.
    """
    import ssl  # local import keeps module load fast

    ctx: Optional[ssl.SSLContext] = None
    if ca_bundle:
        ctx = ssl.create_default_context(cafile=ca_bundle)

    req = urllib.request.Request(url)
    if auth_headers:
        for key, value in auth_headers.items():
            req.add_header(key, value)

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:  # nosec B310
            return resp.read().decode("utf-8", errors="replace").splitlines()
    except Exception as exc:
        print(f"[query_logs] WARNING logtail {url!r}: {exc}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def search_logtail(
    entry: Dict[str, Any],
    auth_headers: Optional[Dict[str, str]] = None,
    ca_bundle: Optional[str] = None,
) -> Dict[str, Any]:
    """Query a logtail plan entry for every keyword and return presence distribution.

    Parameters
    ----------
    entry:
        A single ``"logtail"`` entry from ``plan["logs"]``:
        ``{"url": "...", "time_range": {...}, "keywords": [...]}``.
    auth_headers:
        Optional HTTP headers (e.g. ``{Authorization: Bearer <token>}``).
    ca_bundle:
        Optional path to a CA bundle PEM file for TLS verification.

    Returns
    -------
    dict::

        {
            "url": "<logtail file URL>",
            "keywords": {
                "keyword1": ["2026-04-11T14:13:00Z [ERROR][OmsService]", ...],
                "keyword2": [],
            }
        }
    """
    url = entry["url"]
    time_range = entry.get("time_range", {})
    keywords = entry.get("keywords", [])

    kw_results: Dict[str, List[str]] = {}
    for kw in keywords:
        query_url = _build_query_url(url, kw, time_range)
        lines = _fetch_lines(query_url, auth_headers, ca_bundle)
        parsed = [p for line in lines if (p := parse_log_line(line)) is not None]
        kw_results[kw] = summarize_hits(parsed)

    return {"url": url, "keywords": kw_results}
