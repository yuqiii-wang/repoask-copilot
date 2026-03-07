from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
import uvicorn

from generate_dummy_data import DEFAULT_ISSUES, DEFAULT_PAGES, ensure_generated_data

app = FastAPI()
_IN_MEMORY_ISSUE_CACHE: dict[str, dict] | None = None


def load_generated_issues() -> dict[str, dict]:
    """Load generated Jira issues from in-memory dataset indexed by issue id."""
    global _IN_MEMORY_ISSUE_CACHE
    if _IN_MEMORY_ISSUE_CACHE is not None:
        return _IN_MEMORY_ISSUE_CACHE

    _, issues_docs = ensure_generated_data(pages=DEFAULT_PAGES, issues=DEFAULT_ISSUES)
    issues: dict[str, dict] = {}
    for issue in issues_docs:
        issue_id = str(issue.get("id"))
        issue["id"] = issue_id
        issues[issue_id] = issue

    _IN_MEMORY_ISSUE_CACHE = issues
    return _IN_MEMORY_ISSUE_CACHE


def issue_for_rest_api(issue: dict):
    response_issue = dict(issue)
    fields = issue.get("fields", {})
    response_issue["description"] = fields.get("description", "")
    response_issue["summary"] = fields.get("summary", "")
    return response_issue


def resolve_issue_by_arg(arg_value: str, issues: dict[str, dict]):
    if arg_value in issues:
        return issues[arg_value]

    normalized = arg_value.strip().upper()
    for issue in issues.values():
        if str(issue.get("key", "")).upper() == normalized:
            return issue

    parsed = urlparse(arg_value)
    if parsed.scheme and parsed.netloc:
        query_params = parse_qs(parsed.query)

        issue_key_candidates = query_params.get("issueKey", [])
        if issue_key_candidates:
            key = issue_key_candidates[0].strip().upper()
            for issue in issues.values():
                if str(issue.get("key", "")).upper() == key:
                    return issue

        issue_id_candidates = query_params.get("issueId", [])
        if issue_id_candidates and issue_id_candidates[0] in issues:
            return issues[issue_id_candidates[0]]

        path_parts = [segment for segment in parsed.path.split("/") if segment]
        if path_parts and path_parts[-1].upper() in {
            str(issue.get("key", "")).upper() for issue in issues.values()
        }:
            key = path_parts[-1].upper()
            for issue in issues.values():
                if str(issue.get("key", "")).upper() == key:
                    return issue

    lowered = arg_value.strip().lower()
    for issue in issues.values():
        if str(issue.get("fields", {}).get("summary", "")).lower() == lowered:
            return issue

    raise HTTPException(status_code=404, detail="Issue not found")


@app.get("/rest/api/2/issue/{issue_arg}")
async def get_issue(issue_arg: str):
    """Get a Jira issue by ID or key from generated dataset."""
    issues = load_generated_issues()
    if issue_arg in issues:
        return issue_for_rest_api(issues[issue_arg])

    for issue in issues.values():
        if str(issue.get("key", "")).upper() == issue_arg.upper():
            return issue_for_rest_api(issue)

    raise HTTPException(status_code=404, detail="Issue not found")


@app.get("/rest/api/2/search")
async def search_issues(project: str | None = Query(default=None)):
    """Search Jira issues from generated dataset."""
    issues = [issue_for_rest_api(issue) for issue in load_generated_issues().values()]
    if project:
        issues = [
            issue
            for issue in issues
            if issue.get("fields", {}).get("project", {}).get("key") == project
        ]

    return {
        "startAt": 0,
        "maxResults": len(issues),
        "total": len(issues),
        "issues": issues,
    }


@app.get("/rest/api/2/issue/resolve")
async def resolve_issue(arg: str = Query(...)):
    """Resolve issue by id, key, URL, or exact summary"""
    return issue_for_rest_api(resolve_issue_by_arg(arg, load_generated_issues()))


@app.get("/", response_class=HTMLResponse)
async def index():
    issues = load_generated_issues()
    cards = []
    for issue in issues.values():
        fields = issue.get("fields", {})
        cards.append(
            f"<li><a href='{issue.get('_links', {}).get('webui', '#')}'>{issue.get('key', '-')}</a>: "
            f"{fields.get('summary', '-')} ({fields.get('status', {}).get('name', '-')})</li>"
        )

    return (
        "<h1>Jira Generated Data Server</h1>"
        "<p>Use <code>/rest/api/2/search</code> for JSON API from generated data.</p>"
        f"<ul>{''.join(cards)}</ul>"
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)