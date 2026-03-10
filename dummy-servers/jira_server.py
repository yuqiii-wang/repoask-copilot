from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import json
import os

app = FastAPI()

def load_dummy_data():
    data_path = os.path.join(os.path.dirname(__file__), 'dummy_data.json')
    if os.path.exists(data_path):
        with open(data_path, 'r', encoding='utf-8') as f:
            return json.load(f).get('jira', {})
    return {}

try:
    DUMMY_JIRA_ISSUES = load_dummy_data()
except Exception:
    DUMMY_JIRA_ISSUES = {}

@app.get('/browse/{issue_key}')
async def jira_ui_view(issue_key: str):
    issue = DUMMY_JIRA_ISSUES.get(issue_key)
    if issue:
        return JSONResponse(content=issue)
    return JSONResponse(status_code=404, content={'message': 'Issue not found'})

@app.get('/rest/api/2/issue/resolve')
async def resolve_issue(arg: str):
    issue = DUMMY_JIRA_ISSUES.get(arg)
    if not issue:
        for v in DUMMY_JIRA_ISSUES.values():
            if v['id'] == arg:
                issue = v
                break
    if issue:
        return JSONResponse(content=issue)
    return JSONResponse(status_code=404, content={'message': 'Issue not found'})

@app.get('/rest/api/2/issue/{issue_id_or_key}')
async def get_issue(issue_id_or_key: str):
    issue = DUMMY_JIRA_ISSUES.get(issue_id_or_key)
    if not issue:
        for v in DUMMY_JIRA_ISSUES.values():
            if v['id'] == issue_id_or_key:
                issue = v
                break
    if issue:
        return JSONResponse(content=issue)
    return JSONResponse(status_code=404, content={'message': 'Issue not found'})

@app.get('/rest/api/2/search')
async def search_issues(project: str = None):
    results = list(DUMMY_JIRA_ISSUES.values())
    if project:
        results = [issue for issue in results if issue['key'].startswith(project)]
    return JSONResponse(content={'issues': results, 'total': len(results)})

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8002)
