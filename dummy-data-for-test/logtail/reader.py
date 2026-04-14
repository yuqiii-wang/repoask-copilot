"""Log file discovery and reading helpers."""

import os
from fastapi import HTTPException

from .config import LOGS_DIR, TS_FILENAME_RE


def list_logs() -> list[str]:
    """Return all log filenames sorted alphabetically."""
    if not os.path.isdir(LOGS_DIR):
        return []
    return sorted(
        f for f in os.listdir(LOGS_DIR)
        if os.path.isfile(os.path.join(LOGS_DIR, f))
    )


def list_components() -> list[str]:
    """Return sorted unique component prefixes derived from log filenames."""
    components: set[str] = set()
    for name in list_logs():
        m = TS_FILENAME_RE.match(name)
        if m:
            components.add(m.group(1))
    return sorted(components)


def list_files_for_component(component: str) -> list[str]:
    """Return log filenames that belong to the given component prefix."""
    prefix = f"{component}-"
    return [f for f in list_logs() if f.startswith(prefix)]


def read_log(filename: str) -> list[str]:
    """Read and return all lines of a log file. Raises HTTPException on bad input."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(LOGS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Log file '{filename}' not found")
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.readlines()
