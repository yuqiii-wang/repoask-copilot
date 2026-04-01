from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse, Response as PlainResponse
from fastapi import Header
from typing import Optional
import json
import os
from template_utils import render_home_template

app = FastAPI()

def load_dummy_data():
    data_path = os.path.join(os.path.dirname(__file__), 'dummy_data.json')
    if os.path.exists(data_path):
        with open(data_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

try:
    dummy_data = load_dummy_data()
    DUMMY_CONFLUENCE_PAGES = dummy_data.get('confluence', {})
    DUMMY_JIRA_ISSUES = dummy_data.get('jira', {})
except Exception:
    DUMMY_CONFLUENCE_PAGES = {}
    DUMMY_JIRA_ISSUES = {}

@app.get('/')
async def home():
    html_content = render_home_template(DUMMY_CONFLUENCE_PAGES, {})
    return HTMLResponse(content=html_content)

@app.get('/confluence/spaces/{spaceKey}/pages/{pageId}/{title}')
async def confluence_ui_view(spaceKey: str, pageId: str, title: str):
    page = DUMMY_CONFLUENCE_PAGES.get(pageId)
    if page:
        page_title = page.get('title', 'Untitled')
        body_content = page.get('body', {}).get('storage', {}).get('value', 'No content')
        html_content = f'''
        <html>
            <head>
                <title>Confluence Page: {page_title}</title>
                <style>
                    body {{ font-family: Arial, sans-serif; margin: 20px; }}
                    .page-container {{ border: 1px solid #ddd; padding: 20px; border-radius: 5px; }}
                    .page-title {{ font-size: 24px; font-weight: bold; color: #1a73e8; margin-bottom: 20px; }}
                    .page-content {{ margin: 20px 0; }}
                    .page-content table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
                    .page-content th, .page-content td {{ border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }}
                    .page-content th {{ background: #f3f4f6; }}
                    .page-content ul, .page-content ol {{ margin: 8px 0 8px 20px; padding: 0; }}
                    .page-content li {{ margin: 4px 0; }}
                    .page-content pre {{ background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px; overflow-x: auto; }}
                    .back-link {{ margin-top: 20px; }}
                </style>
            </head>
            <body>
                <div class="page-container">
                    <div class="page-title">{page_title}</div>
                    <div class="page-content">{body_content}</div>
                    <div class="back-link">
                        <a href="/">Back to Home</a>
                    </div>
                </div>
            </body>
        </html>
        '''
        return HTMLResponse(content=html_content)
    return HTMLResponse(status_code=404, content='<h1>Page not found</h1><a href="/">Back to Home</a>')

def _build_page_response(page: dict, expand: str = None) -> dict:
    """
    Mimic real Confluence REST API content shape.

    Real Confluence behaviour:
      - version is always present in the base response.
      - body is NOT included by default; it appears in _expandable.
      - Pass expand=body.storage (or body.view, body.export_view) to get content.
      - Pass expand=version to get full version metadata (when, by, message, etc.).

    This lets callers do a cheap version-check GET and only fetch the full
    body when the version number has changed.
    """
    expand_set = set((expand or '').split(','))

    version = page.get('version', {'number': 1})
    full_version = {
        'number': version.get('number', 1),
        'when': version.get('when', '2024-01-01T00:00:00.000Z'),
        'minorEdit': version.get('minorEdit', False),
        'message': version.get('message', ''),
        'by': version.get('by', {'type': 'user', 'username': 'dummy-user', 'displayName': 'Dummy User'}),
    }

    result = {
        'id': page['id'],
        'type': page.get('type', 'page'),
        'status': page.get('status', 'current'),
        'title': page.get('title', ''),
        'version': full_version,
        '_links': {
            **page.get('_links', {}),
            'self': f'/confluence/rest/api/content/{page["id"]}',
            'webui': page.get('_links', {}).get('webui', ''),
        },
        '_expandable': {},
    }

    if 'body.storage' in expand_set or 'body' in expand_set:
        result['body'] = page.get('body', {'storage': {'value': '', 'representation': 'storage'}})
    else:
        result['_expandable']['body'] = f'/confluence/rest/api/content/{page["id"]}?expand=body.storage'

    return result


def _etag_for_page(page: dict) -> str:
    """Generate a stable ETag from the page id + version number."""
    version_num = page.get('version', {}).get('number', 1)
    return f'"{page["id"]}-v{version_num}"'


@app.get('/confluence/rest/api/content/{page_id}/version')
async def get_page_version(page_id: str):
    """
    Lightweight endpoint to retrieve only version metadata.

    Mirrors the undocumented but widely used:
      GET /wiki/rest/api/content/{id}/version
    which returns the version history list. Here we return the current
    version so callers can check whether a download is necessary.
    """
    page = DUMMY_CONFLUENCE_PAGES.get(page_id)
    if not page:
        return JSONResponse(status_code=404, content={'message': 'Page not found'})

    version = page.get('version', {'number': 1})
    full_version = {
        'number': version.get('number', 1),
        'when': version.get('when', '2024-01-01T00:00:00.000Z'),
        'minorEdit': version.get('minorEdit', False),
        'message': version.get('message', ''),
        'by': version.get('by', {'type': 'user', 'username': 'dummy-user', 'displayName': 'Dummy User'}),
        'content': {'id': page_id},
    }
    return JSONResponse(content={'results': [full_version], 'start': 0, 'limit': 200, 'size': 1})


@app.get('/confluence/rest/api/content/{page_id}')
async def get_page(page_id: str, expand: str = None,
                   if_none_match: Optional[str] = Header(None, alias='If-None-Match')):
    """
    Get page metadata (and optionally body).

    expand parameter (comma-separated):
      body.storage  – include storage-format HTML body
      body.view     – (alias) include body
      version       – already included by default

    Version-skip pattern (mirrors real-world usage):
      1. Client GETs without expand to read version.number.
      2. If version unchanged, skip the full body download.
      3. Or use If-None-Match with the ETag returned previously.
    """
    page = DUMMY_CONFLUENCE_PAGES.get(page_id)
    if not page:
        return JSONResponse(status_code=404, content={'message': 'Page not found'})

    etag = _etag_for_page(page)

    # ETag conditional request – 304 Not Modified when version unchanged
    if if_none_match and if_none_match == etag:
        return PlainResponse(status_code=304,
                             headers={'ETag': etag, 'Cache-Control': 'no-cache'})

    response_data = _build_page_response(page, expand)
    return JSONResponse(
        content=response_data,
        headers={'ETag': etag, 'Cache-Control': 'no-cache'},
    )

@app.put('/confluence/rest/api/content/{page_id}')
async def update_page(page_id: str, request: Request):
    """
    Update a page – mirrors Confluence PUT /wiki/rest/api/content/{id}.

    Real Confluence requires the caller to pass the NEXT version number
    (current + 1) in the version.number field; we do the same validation.
    """
    page = DUMMY_CONFLUENCE_PAGES.get(page_id)
    if not page:
        return JSONResponse(status_code=404, content={'message': 'Page not found'})

    try:
        update_data = await request.json()

        # Version conflict check (mirror real Confluence behaviour)
        current_version = page.get('version', {}).get('number', 1)
        new_version = update_data.get('version', {}).get('number')
        if new_version is not None and new_version != current_version + 1:
            return JSONResponse(
                status_code=409,
                content={
                    'message': (
                        f'Version conflict: expected {current_version + 1}, '
                        f'got {new_version}'
                    ),
                    'statusCode': 409,
                },
            )

        # Apply updates
        if 'body' in update_data:
            storage = update_data['body'].get('storage')
            if storage:
                page['body']['storage'] = storage
        if 'title' in update_data:
            page['title'] = update_data['title']

        # Increment version
        page['version'] = {
            'number': current_version + 1,
            'when': update_data.get('version', {}).get('when', '2024-01-01T00:00:00.000Z'),
            'minorEdit': update_data.get('version', {}).get('minorEdit', False),
            'message': update_data.get('version', {}).get('message', ''),
        }

        etag = _etag_for_page(page)
        return JSONResponse(
            content=_build_page_response(page, 'body.storage'),
            headers={'ETag': etag},
        )
    except Exception as exc:
        return JSONResponse(status_code=400, content={'message': f'Error updating page: {exc}'})

@app.get('/confluence/rest/api/content')
async def get_all_pages(expand: str = None, space_key: str = None, title: str = None,
                        start: int = 0, limit: int = 25):
    """
    List pages – mirrors Confluence GET /wiki/rest/api/content.
    Returns version info but body is in _expandable unless expand=body.storage.
    """
    pages = list(DUMMY_CONFLUENCE_PAGES.values())
    if title:
        pages = [p for p in pages if p.get('title', '').lower() == title.lower()]
    total = len(pages)
    pages = pages[start:start + limit]
    results = [_build_page_response(p, expand) for p in pages]
    return JSONResponse(content={
        'results': results,
        'start': start,
        'limit': limit,
        'size': len(results),
        '_links': {'self': '/confluence/rest/api/content'},
    })

@app.post('/confluence/rest/api/content')
async def create_page(request: Request):
    """
    Create a page – mirrors Confluence POST /wiki/rest/api/content.

    Expected request body:
      {
        "type": "page",
        "title": "...",
        "space": {"key": "PROJ"},
        "body": {
          "storage": {"value": "<p>...</p>", "representation": "storage"}
        }
      }
    Returns the created page with version.number = 1 and a new generated id.
    """
    try:
        data = await request.json()
    except Exception as exc:
        return JSONResponse(status_code=400, content={'message': f'Invalid JSON: {exc}'})

    title = data.get('title', 'Untitled')
    body = data.get('body', {'storage': {'value': '', 'representation': 'storage'}})
    page_type = data.get('type', 'page')
    space_key = data.get('space', {}).get('key', 'PROJ')

    # Generate a unique integer-style id (real Confluence uses integers)
    import time as _time
    new_id = str(int(_time.time() * 1000))

    new_page = {
        'id': new_id,
        'type': page_type,
        'status': 'current',
        'title': title,
        'body': body,
        'space': {'key': space_key},
        'version': {
            'number': 1,
            'when': '2024-01-01T00:00:00.000Z',
            'minorEdit': False,
            'message': '',
            'by': {'type': 'user', 'username': 'dummy-user', 'displayName': 'Dummy User'},
        },
        '_links': {
            'webui': f'/confluence/spaces/{space_key}/pages/{new_id}/{title.replace(" ", "+")}',
        },
    }

    DUMMY_CONFLUENCE_PAGES[new_id] = new_page
    etag = _etag_for_page(new_page)
    return JSONResponse(
        status_code=200,
        content=_build_page_response(new_page, 'body.storage'),
        headers={'ETag': etag},
    )


@app.get('/confluence/rest/api/content/{page_id}/child/page')
async def get_page_children(page_id: str, expand: str = None):
    return JSONResponse(content={'results': []})

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8091)
