"""FastAPI app and route handlers for the Logtail dummy server.

Endpoints
---------
GET /                                          – HTML home / index
GET /logTail                                   – HTML <ul> list of component list-URLs (extractable by regex)
GET /logTail/{component}?list                  – HTML <ul> list of file URLs for a component
GET /logTail/{component}?file={filename}       – Plain-text log content (all GET filter params apply)

GET params for ?file=…
  f   HH:MM   From time (inclusive)
  t   HH:MM   To time (inclusive)
  i   text    Include only lines containing this (case-insensitive)
  e   text    Exclude lines containing this
  n   int     Return last N lines (applied after time filter)
"""

import sys, os
# Allow running as a standalone script from the dummy-data-for-test/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import PlainTextResponse, HTMLResponse
from typing import Optional

from .reader import list_components, list_files_for_component, read_log
from .filters import filter_by_time, apply_text_filters

try:
    from template_utils import render_home_template
except ImportError:
    # fallback when imported from a different working directory
    import importlib.util, pathlib
    _spec = importlib.util.spec_from_file_location(
        "template_utils",
        pathlib.Path(__file__).parent.parent / "template_utils.py",
    )
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    render_home_template = _mod.render_home_template


app = FastAPI(title="Logtail Dummy Server", version="2.0.0")


# ---------------------------------------------------------------------------
# Home
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    components = list_components()
    sections = [
        {
            "title": "Log Components",
            "items": [
                {
                    "title": name,
                    "description": f"<a href='/logTail/{name}?list'>list files</a>",
                    "url": f"/logTail/{name}?list",
                }
                for name in components
            ],
        }
    ]
    return render_home_template(
        title="Logtail Dummy Server",
        description="Serves log files from dummy-trading-system/logs/.",
        port=8093,
        sections=sections,
    )


# ---------------------------------------------------------------------------
# /logTail  – component index  (HTML <ul><li><a href=...>)
# ---------------------------------------------------------------------------

@app.get("/logTail", response_class=HTMLResponse)
async def list_components_endpoint(request: Request):
    """Return all known log components as an HTML list.

    Callers can extract URLs with a simple regex on <a href="..."> or by
    parsing the <li> anchors.
    """
    base = str(request.base_url).rstrip("/")
    components = list_components()
    items = "\n".join(
        f'  <li><a href="{base}/logTail/{name}?list">{base}/logTail/{name}?list</a></li>'
        for name in components
    )
    html = (
        "<html><body>\n"
        "<h2>Log Components</h2>\n"
        "<ul>\n"
        f"{items}\n"
        "</ul>\n"
        "</body></html>"
    )
    return HTMLResponse(html)


# ---------------------------------------------------------------------------
# /logTail/{component}  – file listing or log retrieval
# ---------------------------------------------------------------------------

@app.get("/logTail/{component}")
async def component_endpoint(
    component: str,
    request: Request,
    file: Optional[str] = Query(default=None, description="Log filename to retrieve"),
    i: Optional[str] = Query(default=None, description="Include only lines containing this (case-insensitive)"),
    e: Optional[str] = Query(default=None, description="Exclude lines containing this"),
    n: Optional[int] = Query(default=None, ge=1, le=100_000, description="Return last N lines (tail)"),
    f: Optional[str] = Query(default=None, description="From time HH:MM (inclusive)"),
    t: Optional[str] = Query(default=None, description="To time HH:MM (inclusive)"),
):
    if "/" in component or ".." in component:
        raise HTTPException(status_code=400, detail="Invalid component name")

    # ?list — enumerate available files as an HTML <ul><li><a href=...> list
    if "list" in request.query_params and file is None:
        files = list_files_for_component(component)
        if not files:
            raise HTTPException(
                status_code=404,
                detail=f"Component '{component}' not found or has no log files",
            )
        base = str(request.base_url).rstrip("/")
        items = "\n".join(
            f'  <li><a href="{base}/logTail/{component}?file={fname}">'
            f"{base}/logTail/{component}?file={fname}</a></li>"
            for fname in files
        )
        html = (
            f"<html><body>\n"
            f"<h2>Log files for <em>{component}</em></h2>\n"
            f"<ul>\n{items}\n</ul>\n"
            f"</body></html>"
        )
        return HTMLResponse(html)

    # ?file=filename — retrieve / filter a specific log file
    if file:
        lines = read_log(file)

        if f or t:
            lines = filter_by_time(lines, f, t)

        if n:
            lines = lines[-n:]

        lines = apply_text_filters(lines, i, e)

        if (i or e) and not lines:
            raise HTTPException(status_code=404, detail="No lines matched the given filters")

        return PlainTextResponse("".join(lines))

    raise HTTPException(
        status_code=400,
        detail="Use ?list to enumerate files or ?file=<filename> to retrieve a log",
    )


# ---------------------------------------------------------------------------
# Entry point (when run directly as a module)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8093)
