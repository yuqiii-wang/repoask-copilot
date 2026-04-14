"""Logtail HTML listing and plan-entry resolution for build_plan."""

import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

from ._timestamps import parse_filename_ts, to_logtail_ts

# How far before start_time to still include a log file.
DEFAULT_LOOKBACK_HOURS = 3


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: List[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "a":
            for name, val in attrs:
                if name == "href" and val:
                    self.links.append(val)


def _make_ssl_context(ca_bundle: Optional[str]) -> Optional[ssl.SSLContext]:
    """Return an SSLContext using *ca_bundle* if provided, or None for default CA store."""
    if ca_bundle:
        ctx = ssl.create_default_context(cafile=ca_bundle)
        return ctx
    return None


def list_logtail_files(
    base_url: str,
    component: str,
    ca_bundle: Optional[str] = None,
) -> List[str]:
    """
    GET {base_url}/{component}?list and return all href URLs from the response.
    Returns an empty list on any HTTP or connection error.
    """
    url = f"{base_url.rstrip('/')}/{component}?list"
    ctx = _make_ssl_context(ca_bundle)
    try:
        with urllib.request.urlopen(url, context=ctx, timeout=10) as resp:  # nosec B310
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"[build_plan] WARNING: could not list {url}: {exc}", file=sys.stderr)
        return []
    parser = _LinkParser()
    parser.feed(html)
    return parser.links


def resolve_logtail(
    row: Dict[str, str],
    source: Dict[str, Any],
    start: datetime,
    end: datetime,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    ca_bundle: Optional[str] = None,
) -> List[Dict[str, Any]]:
    base_url = row["base_url"].strip()
    component = (
        source["tags"][0]
        if source.get("tags")
        else row["tags"].strip().split(",")[0].strip()
    )

    all_links = list_logtail_files(base_url, component, ca_bundle=ca_bundle)
    if not all_links:
        print(
            f"[build_plan] WARNING: no log files found for logtail component '{component}'",
            file=sys.stderr,
        )
        return []

    lookback_cutoff = start - timedelta(hours=lookback_hours)
    entries: List[Dict[str, Any]] = []

    for href in all_links:
        m = re.search(r"[?&]file=([^&]+)", href)
        filename = m.group(1) if m else os.path.basename(href)

        file_ts = parse_filename_ts(filename)
        if file_ts is not None:
            if file_ts > end:
                continue
            if file_ts < lookback_cutoff:
                continue

        entries.append(
            {
                "type": "logtail",
                "url": href,
                "time_range": {
                    "start": to_logtail_ts(start),
                    "end": to_logtail_ts(end),
                },
                "keywords": source.get("keywords", []),
            }
        )

    return entries

    base_url = row["base_url"].strip()
    component = (
        source["tags"][0]
        if source.get("tags")
        else row["tags"].strip().split(",")[0].strip()
    )

    all_links = list_logtail_files(base_url, component)
    if not all_links:
        print(
            f"[build_plan] WARNING: no log files found for logtail component '{component}'",
            file=sys.stderr,
        )
        return []

    lookback_cutoff = start - timedelta(hours=lookback_hours)
    entries: List[Dict[str, Any]] = []

    for href in all_links:
        m = re.search(r"[?&]file=([^&]+)", href)
        filename = m.group(1) if m else os.path.basename(href)

        file_ts = parse_filename_ts(filename)
        if file_ts is not None:
            if file_ts > end:
                continue
            if file_ts < lookback_cutoff:
                continue

        entries.append(
            {
                "type": "logtail",
                "url": href,
                "time_range": {
                    "start": to_logtail_ts(start),
                    "end": to_logtail_ts(end),
                },
                "keywords": source.get("keywords", []),
            }
        )

    return entries
