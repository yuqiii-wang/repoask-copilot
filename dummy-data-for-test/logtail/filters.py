"""Time and text filtering helpers for log lines."""

import re
from datetime import datetime, time as dt_time
from typing import Optional

from fastapi import HTTPException

from .config import LOG_TIMESTAMP_RE, TIMESTAMP_FMT, HHMM_RE


def parse_ts(line: str) -> Optional[datetime]:
    m = LOG_TIMESTAMP_RE.match(line)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), TIMESTAMP_FMT)
    except ValueError:
        return None


def parse_hhmm(hhmm: str) -> dt_time:
    """Parse HH:MM into a time object. Raises HTTPException 400 on failure."""
    m = HHMM_RE.match(hhmm.strip())
    if not m:
        raise HTTPException(
            status_code=400,
            detail=f"Unrecognised time format: {hhmm!r}. Expected HH:MM",
        )
    hour, minute = int(m.group(1)), int(m.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise HTTPException(status_code=400, detail=f"Invalid time value: {hhmm!r}")
    return dt_time(hour, minute)


def filter_by_time(
    lines: list[str],
    from_hhmm: Optional[str],
    to_hhmm: Optional[str],
) -> list[str]:
    from_t = parse_hhmm(from_hhmm) if from_hhmm else None
    to_t   = parse_hhmm(to_hhmm)   if to_hhmm   else None
    result: list[str] = []
    current_ts: Optional[datetime] = None
    for line in lines:
        ts = parse_ts(line)
        if ts is not None:
            current_ts = ts
        if current_ts is None:
            continue
        t = current_ts.time().replace(second=0, microsecond=0)
        if from_t and t < from_t:
            continue
        if to_t and t > to_t:
            continue
        result.append(line)
    return result


def apply_text_filters(
    lines: list[str],
    include: Optional[str],
    exclude: Optional[str],
) -> list[str]:
    """Apply case-insensitive include/exclude text filters."""
    if include:
        pat_i = re.compile(re.escape(include), re.IGNORECASE)
        lines = [ln for ln in lines if pat_i.search(ln)]
    if exclude:
        pat_e = re.compile(re.escape(exclude), re.IGNORECASE)
        lines = [ln for ln in lines if not pat_e.search(ln)]
    return lines
