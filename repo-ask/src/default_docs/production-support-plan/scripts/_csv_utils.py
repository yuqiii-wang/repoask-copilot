"""CSV loading and lookup helpers for build_plan."""

import csv
from typing import Dict, List, Optional


def load_csv(path: str) -> List[Dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="|"))


def find_logtail_row(
    rows: List[Dict[str, str]],
    env: str,
    tag: str,
) -> Optional[Dict[str, str]]:
    """
    Return the logtail CSV row whose tags column contains `tag`.
    The tag is the component prefix used in the logtail URL path.
    """
    for row in rows:
        if row.get("environment", "").strip() != env:
            continue
        if row.get("type", "").strip() != "logtail":
            continue
        row_tags = [t.strip() for t in row.get("tags", "").split(",")]
        if tag in row_tags:
            return row
    return None


def find_loki_row(
    rows: List[Dict[str, str]],
    env: str,
) -> Optional[Dict[str, str]]:
    """
    Return the first loki CSV row for the given environment.
    There is typically one Loki server per environment; the `tags` column
    of that row is the Loki `job` label (e.g. ``app-logs``).
    """
    for row in rows:
        if row.get("environment", "").strip() != env:
            continue
        if row.get("type", "").strip() == "loki":
            return row
    return None
