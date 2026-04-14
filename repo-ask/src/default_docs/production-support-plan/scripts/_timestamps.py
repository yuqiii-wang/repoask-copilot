"""Timestamp parsing and formatting helpers for build_plan."""

import re
from datetime import datetime
from typing import Optional

# Logtail filename format: {component}-{YYYYMMDDHHmmssSSS}.log  (17 digits)
_FILENAME_TS_RE = re.compile(r"^.+-(\d{17})\.log$")

# Compact timestamp used in template: YYYYMMDDHHmmss (14 digits)
_COMPACT_TS_RE = re.compile(r"^\d{14}$")


def parse_filename_ts(name: str) -> Optional[datetime]:
    """Return the datetime embedded in a logtail log filename, or None."""
    m = _FILENAME_TS_RE.match(name)
    if not m:
        return None
    raw = m.group(1)  # YYYYMMDDHHmmssSSS — take the first 14 chars (no ms)
    try:
        return datetime.strptime(raw[:14], "%Y%m%d%H%M%S")
    except ValueError:
        return None


def parse_ts(ts: str) -> Optional[datetime]:
    """
    Parse a timestamp from the template.  Accepts:
    - YYYYMMDDHHmmss  (14 digits, compact)
    - YYYY-MM-DD HH:MM:SS[.mmm]
    - YYYY-MM-DDTHH:MM:SSZ
    """
    if not ts:
        return None
    ts = ts.strip()
    if _COMPACT_TS_RE.match(ts):
        return datetime.strptime(ts, "%Y%m%d%H%M%S")
    if " " in ts:
        try:
            return datetime.strptime(ts.split(".")[0], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def to_logtail_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S.000")


def to_iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
