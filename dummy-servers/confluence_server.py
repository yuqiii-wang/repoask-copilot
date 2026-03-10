from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import json
import os

app = FastAPI()

def load_dummy_data():
    data_path = os.path.join(os.path.dirname(__file__), 'dummy_data.json')
    if os.path.exists(data_path):
        with open(data_path, 'r', encoding='utf-8') as f:
            return json.load(f).get('confluence', {})
    return {}

try:
    DUMMY_CONFLUENCE_PAGES = load_dummy_data()
except Exception:
    DUMMY_CONFLUENCE_PAGES = {}

@app.get('/confluence/spaces/{spaceKey}/pages/{pageId}/{title}')
async def confluence_ui_view(spaceKey: str, pageId: str, title: str):
    page = DUMMY_CONFLUENCE_PAGES.get(pageId)
    if page:
        return JSONResponse(content=page)
    return JSONResponse(status_code=404, content={'message': 'Page not found'})

@app.get('/confluence/rest/api/content/{page_id}')
async def get_page(page_id: str, expand: str = None):
    page = DUMMY_CONFLUENCE_PAGES.get(page_id)
    if page:
        return JSONResponse(content=page)
    return JSONResponse(status_code=404, content={'message': 'Page not found'})

@app.get('/rest/api/content')
async def get_all_pages(expand: str = None):
    return JSONResponse(content={'results': list(DUMMY_CONFLUENCE_PAGES.values())})

@app.get('/confluence/rest/api/content/{page_id}/child/page')
async def get_page_children(page_id: str, expand: str = None):
    return JSONResponse(content={'results': []})

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8001)
