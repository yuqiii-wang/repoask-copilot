"""
Logtail dummy server – hosts log files from the dummy-servers/logs/ directory.

Endpoints
---------
GET /                                                – HTML home / index
GET /logTail                                         – HTML list of all components with their list URLs
GET /logTail/{component}?list                        – HTML list of log files for a component (parse URLs by regex)
GET /logTail/{component}?file={filename}             – Return full log content (plain text)
GET /logTail/{component}?file={filename}&n=N         – Return last N lines (tail; default: all)
GET /logTail/{component}?file={filename}&f=HH:MM&t=HH:MM
                                                     – Return time-filtered log lines (plain text)
GET /logTail/{component}?file={filename}&i={text}    – Return lines including text (plain text)
GET /logTail/{component}?file={filename}&e={text}    – Return lines excluding text (plain text)
GET /logTail/{component}?file={filename}&i={text}&f=HH:MM&t=HH:MM
                                                     – Search within time-filtered window (plain text)
GET /logTail/{component}?file={filename}&i={text}&n=N
                                                     – Search last N lines for text (plain text)

Runs on port 8093.
"""

from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import PlainTextResponse, HTMLResponse
import os
import re
from datetime import datetime, time as dt_time
from typing import Optional
from template_utils import render_home_template

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")
LOG_TIMESTAMP_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})"
)
TIMESTAMP_FMT = "%Y-%m-%d %H:%M:%S.%f"
_TS_FILENAME_RE = re.compile(r"^(.+)-(\d{12})\.log$")

app = FastAPI(title="Logtail Dummy Server", version="1.0.0")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _list_logs() -> list[str]:
    if not os.path.isdir(LOGS_DIR):
        return []
    return sorted(
        f for f in os.listdir(LOGS_DIR)
        if os.path.isfile(os.path.join(LOGS_DIR, f))
    )


def _list_components() -> list[str]:
    """Return sorted list of unique component prefixes derived from log filenames."""
    components: set[str] = set()
    for name in _list_logs():
        m = _TS_FILENAME_RE.match(name)
        if m:
            components.add(m.group(1))
    return sorted(components)


def _list_files_for_component(component: str) -> list[str]:
    """Return log filenames that belong to the given component prefix."""
    prefix = f"{component}-"
    return [f for f in _list_logs() if f.startswith(prefix)]


def _read_log(filename: str) -> list[str]:
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(LOGS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Log file '{filename}' not found")
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.readlines()


def _parse_ts(line: str) -> Optional[datetime]:
    m = LOG_TIMESTAMP_RE.match(line)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), TIMESTAMP_FMT)
    except ValueError:
        return None


_HHMM_RE = re.compile(r'^(\d{1,2}):(\d{2})$')


def _parse_hhmm(hhmm: str) -> dt_time:
    """Parse HH:MM into a time object. Raises HTTPException 400 on failure."""
    m = _HHMM_RE.match(hhmm.strip())
    if not m:
        raise HTTPException(
            status_code=400,
            detail=f"Unrecognised time format: {hhmm!r}. Expected HH:MM",
        )
    hour, minute = int(m.group(1)), int(m.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise HTTPException(status_code=400, detail=f"Invalid time value: {hhmm!r}")
    return dt_time(hour, minute)


def _filter_by_time(lines: list[str], from_hhmm: Optional[str], to_hhmm: Optional[str]) -> list[str]:
    from_t = _parse_hhmm(from_hhmm) if from_hhmm else None
    to_t   = _parse_hhmm(to_hhmm)   if to_hhmm   else None
    result = []
    current_ts: Optional[datetime] = None
    for line in lines:
        ts = _parse_ts(line)
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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    components = _list_components()
    base = str(request.base_url).rstrip("/")
    sections = [
        {
            "title": "Log Components",
            "items": [
                {
                    "title": name,
                    "description": f"<a href='/logTail/{name}?list'>list files</a>",
                    "url": f"/logTail/{name}?list",
                } for name in components
            ],
        }
    ]
    return render_home_template(
        title="Logtail Dummy Server",
        description="Serves log files for the trading system simulation.",
        port=8093,
        sections=sections,
    )


@app.get("/logTail", response_class=HTMLResponse)
async def list_components_endpoint(request: Request):
    """Return all known log components as HTML. Parse log file list URLs by regex."""
    base = str(request.base_url).rstrip("/")
    components = _list_components()
    items = "\n".join(
        f'<li><a href="{base}/logTail/{name}?list">{base}/logTail/{name}?list</a></li>'
        for name in components
    )
    return HTMLResponse(f"<html><body><ul>\n{items}\n</ul></body></html>")


@app.get("/logTail/{component}")
async def component_endpoint(
    component: str,
    request: Request,
    file: Optional[str] = Query(default=None, description="Log filename to retrieve"),
    i: Optional[str] = Query(default=None, description="Include only lines containing this text (case-insensitive); plain-text response"),
    e: Optional[str] = Query(default=None, description="Exclude lines containing this text (case-insensitive)"),
    n: Optional[int] = Query(default=None, ge=1, le=100000, description="Return last N lines (tail)"),
    f: Optional[str] = Query(default=None, description="From time HH:MM (inclusive)"),
    t: Optional[str] = Query(default=None, description="To time HH:MM (inclusive)"),
):
    if "/" in component or ".." in component:
        raise HTTPException(status_code=400, detail="Invalid component name")

    # ?list — enumerate available files for this component as HTML
    if "list" in request.query_params and file is None and i is None:
        files = _list_files_for_component(component)
        if not files:
            raise HTTPException(status_code=404, detail=f"Component '{component}' not found or has no log files")
        base = str(request.base_url).rstrip("/")
        items = "\n".join(
            f'<li><a href="{base}/logTail/{component}?file={fname}">{base}/logTail/{component}?file={fname}</a></li>'
            for fname in files
        )
        return HTMLResponse(f"<html><body><ul>\n{items}\n</ul></body></html>")

    # ?file=filename — retrieve or search a specific log file
    if file:
        lines = _read_log(file)

        # Apply time filter first
        if f or t:
            lines = _filter_by_time(lines, f, t)

        # Apply tail limit
        if n:
            lines = lines[-n:]

        # ?i=text — include filter: return matching lines as plain text
        if i:
            include_pat = re.compile(re.escape(i), re.IGNORECASE)
            if e:
                exclude_pat = re.compile(re.escape(e), re.IGNORECASE)
                lines = [ln for ln in lines if include_pat.search(ln) and not exclude_pat.search(ln)]
            else:
                lines = [ln for ln in lines if include_pat.search(ln)]
            if not lines:
                raise HTTPException(status_code=404, detail=f"No matches found for {i!r}")
            return PlainTextResponse("".join(lines))

        # Plain content — optionally exclude lines
        if e:
            exclude_pat = re.compile(re.escape(e), re.IGNORECASE)
            lines = [ln for ln in lines if not exclude_pat.search(ln)]

        return PlainTextResponse("".join(lines))

    raise HTTPException(status_code=400, detail="Use ?list to enumerate files or ?file=<filename> to retrieve a log")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8093)
