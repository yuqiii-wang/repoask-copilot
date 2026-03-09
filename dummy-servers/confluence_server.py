from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
import uvicorn

from generate_dummy_data import DEFAULT_ISSUES, DEFAULT_PAGES, ensure_generated_data

app = FastAPI()
_IN_MEMORY_PAGE_CACHE: dict[str, dict] | None = None


def load_generated_pages() -> dict[str, dict]:
    """Load generated Confluence pages from in-memory dataset indexed by page id."""
    global _IN_MEMORY_PAGE_CACHE
    if _IN_MEMORY_PAGE_CACHE is not None:
        return _IN_MEMORY_PAGE_CACHE

    pages_docs, _ = ensure_generated_data(pages=DEFAULT_PAGES, issues=DEFAULT_ISSUES)
    pages: dict[str, dict] = {}
    for page in pages_docs:
        page_id = str(page.get("id"))
        page["id"] = page_id
        pages[page_id] = page

    _IN_MEMORY_PAGE_CACHE = pages
    return _IN_MEMORY_PAGE_CACHE


def page_for_rest_api(page: dict):
    rest_page = dict(page)
    rest_page["content"] = page.get("body", {}).get("storage", {}).get("value", "")
    return rest_page


def resolve_page_by_arg(arg_value: str, pages: dict[str, dict]):
    if arg_value in pages:
        return pages[arg_value]

    parsed = urlparse(arg_value)
    if parsed.scheme and parsed.netloc:
        query_params = parse_qs(parsed.query)
        page_id_candidates = query_params.get("pageId", [])
        if page_id_candidates and page_id_candidates[0] in pages:
            return pages[page_id_candidates[0]]

        path_parts = [segment for segment in parsed.path.split("/") if segment]
        if path_parts and path_parts[-1] in pages:
            return pages[path_parts[-1]]

    lowered = arg_value.strip().lower()
    for page in pages.values():
        if str(page.get("title", "")).lower() == lowered:
            return page

    raise HTTPException(status_code=404, detail="Page not found")


@app.get("/rest/api/content/{page_id}")
async def get_page(page_id: str):
    """Get a Confluence page by ID from generated dataset."""
    pages = load_generated_pages()
    if page_id not in pages:
        raise HTTPException(status_code=404, detail="Page not found")
    return page_for_rest_api(pages[page_id])


@app.get("/rest/api/content")
async def get_pages(space: str | None = Query(default=None)):
    """Get all Confluence pages from generated dataset."""
    pages = [page_for_rest_api(page) for page in load_generated_pages().values()]
    if space:
        pages = [page for page in pages if page.get("space") == space]
    return pages


@app.get("/rest/api/content/resolve")
async def resolve_page(arg: str = Query(...)):
    """Resolve page by id, URL, or exact title"""
    return page_for_rest_api(resolve_page_by_arg(arg, load_generated_pages()))


@app.get("/wiki/spaces/{space}/pages/{page_id}", response_class=HTMLResponse)
async def get_page_html(space: str, page_id: str):
    """Get a generated Confluence page as HTML."""
    pages = load_generated_pages()
    if page_id not in pages:
        raise HTTPException(status_code=404, detail="Page not found")
    page = pages[page_id]
    if page["space"] != space:
        raise HTTPException(status_code=404, detail="Page not found in given space")
    return page.get("body", {}).get("storage", {}).get("value", "")


@app.get("/", response_class=HTMLResponse)
async def index():
    pages = load_generated_pages()
    cards = []
    for page in pages.values():
        cards.append(
            f"<li><a href='{page['_links']['webui']}'>{page['title']}</a> "
            f"({page.get('space', '-')}) - updated {page.get('last_updated', '-')}</li>"
        )
    return (
        "<h1>Confluence Generated Data Server</h1>"
        "<p>Use <code>/rest/api/content</code> for JSON API or links below for HTML pages.</p>"
        f"<ul>{''.join(cards)}</ul>"
    )


@app.get("/rest/api/content/{page_id}/child/page")
async def get_page_children(page_id: str):
    """Get children for a page (mocked using linked_pages)."""
    pages = load_generated_pages()
    if page_id not in pages:
        raise HTTPException(status_code=404, detail="Page not found")
        
    page = pages[page_id]
    linked_ids = page.get("metadata", {}).get("linked_pages", [])
    results = []
    for lid in linked_ids:
        if lid in pages:
            results.append(page_for_rest_api(pages[lid]))
            
    return {"results": results}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
