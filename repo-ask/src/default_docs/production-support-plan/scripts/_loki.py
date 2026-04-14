"""Loki plan-entry resolution for build_plan."""

from datetime import datetime
from typing import Any, Dict, List

from ._timestamps import to_iso


def resolve_loki(
    row: Dict[str, str],
    source: Dict[str, Any],
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    loki_url = row["base_url"].strip()
    # The CSV row's tags column is the Loki `job` label (e.g. "app-logs").
    # The source's tags are the `component` labels (e.g. "trading-system").
    job = row["tags"].strip().split(",")[0].strip()
    components = source.get("tags") or [job]
    entries = []
    for component in components:
        stream_selector = '{job="' + job + '",component="' + component + '"}'
        entries.append(
            {
                "type": "loki",
                "stream_selector": stream_selector,
                "loki_url": loki_url,
                "start_iso": to_iso(start),
                "end_iso": to_iso(end),
                "keywords": source.get("keywords", []),
            }
        )
    return entries
