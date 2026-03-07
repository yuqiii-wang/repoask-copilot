#!/usr/bin/env python3
"""
Generate complex dummy Confluence pages and Jira issues in-memory.
Run: python generate_dummy_data.py --pages 300 --issues 300
"""
import argparse
import random
from datetime import datetime, timedelta, timezone

SPACES = ["ENG", "PMO", "DEV", "OPS", "HR"]
AUTHORS = ["John Doe", "Jane Smith", "Bob Johnson", "Alice Chen", "Liam Patel", "Nina Garcia"]
PARENT_TOPICS = ["Team Collaboration", "Delivery Excellence", "Engineering Handbook", "Onboarding", "Governance"]
ISSUE_PRIORITIES = ["Low", "Medium", "High", "Highest"]
ISSUE_TYPES = ["Task", "Story", "Bug", "Improvement"]
KEYWORDS_POOL = [
    "architecture",
    "deployment",
    "performance",
    "security",
    "api",
    "testing",
    "onboarding",
    "governance",
    "observability",
    "ux",
]

COMPONENTS_POOL = ["ui", "api", "infra", "docs", "security", "data", "build"]
LABELS_POOL = ["backend", "frontend", "docs", "ops", "template", "bugfix", "perf", "security"]
PAGE_TEMPLATES = [
    "runbook",
    "adr",
    "postmortem",
    "roadmap",
    "api_spec",
    "onboarding",
    "design_review",
]
DEFAULT_PAGES = 300
DEFAULT_ISSUES = 300
JIRA_PROJECT_KEY = "PROJECT"

_DATASET_CACHE: dict[str, object] | None = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_datetime(now: datetime, offset_days: int = 0) -> str:
    return (now - timedelta(days=offset_days)).strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def summarize_text(text: str, max_len: int = 200) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_len:
        return cleaned
    return f"{cleaned[:max_len - 3].rstrip()}..."


def choose_keywords(rng: random.Random, extra_terms: list[str], max_keywords: int = 6) -> list[str]:
    merged = list(dict.fromkeys(KEYWORDS_POOL + [term.lower() for term in extra_terms if term]))
    sample_size = rng.randint(3, min(max_keywords, len(merged)))
    return sorted(rng.sample(merged, sample_size))


def build_confluence_html(
    rng: random.Random,
    title: str,
    author: str,
    parent: str,
    template: str,
    linked_page_ids: list[str],
    linked_issue_keys: list[str],
) -> str:
    reference_links = "".join(
        f"<li><a href='/rest/api/content/{page_id}'>Related Page {page_id}</a></li>"
        for page_id in linked_page_ids
    )
    issue_links = "".join(
        f"<li><a href='/rest/api/2/issue/{issue_key}'>{issue_key}</a></li>" for issue_key in linked_issue_keys
    )

    decisions = "\n".join(
        f"<li>Decision {idx}: {rng.choice(['Adopt', 'Defer', 'Reject'])} option {idx}</li>"
        for idx in range(1, rng.randint(3, 6))
    )
    action_rows = "\n".join(
        f"<tr><td>Action {idx}</td><td>{rng.choice(AUTHORS)}</td><td>{rng.choice(['Open', 'In Progress', 'Done'])}</td></tr>"
        for idx in range(1, rng.randint(3, 7))
    )
    emphasis = rng.choice(["critical", "informational", "experimental", "stable"])
    confidence = rng.randint(70, 99)

    if template == "runbook":
        body = (
            "<h2>Runbook Steps</h2>"
            "<ol>"
            "<li>Validate environment health and metrics baseline.</li>"
            "<li>Deploy artifact to staging and run smoke checks.</li>"
            "<li>Promote to production after approval gate.</li>"
            "<li>Observe alerts and rollback if error budget is exceeded.</li>"
            "</ol>"
        )
    elif template == "adr":
        body = (
            "<h2>Context</h2><p>This architecture decision record documents trade-offs and constraints.</p>"
            "<h2>Decision Log</h2>"
            f"<ul>{decisions}</ul>"
            "<h2>Consequences</h2><p>Operational complexity decreases while observability coverage increases.</p>"
        )
    elif template == "postmortem":
        body = (
            "<h2>Incident Timeline</h2>"
            "<ul><li>T0 Detection</li><li>T+12m Mitigation</li><li>T+35m Resolution</li></ul>"
            "<h2>Root Cause</h2><p>Insufficient circuit breaker thresholds on a high-latency dependency.</p>"
            "<h2>Follow-up Actions</h2>"
            f"<table><thead><tr><th>Action</th><th>Owner</th><th>Status</th></tr></thead><tbody>{action_rows}</tbody></table>"
        )
    elif template == "roadmap":
        quarters = ["Q1", "Q2", "Q3", "Q4"]
        rows = "\n".join(
            f"<tr><td>{q}</td><td>{rng.choice(['Platform Hardening', 'UI Revamp', 'Cost Optimization', 'Migration'])}</td><td>{rng.choice(['Planned', 'In Progress', 'Complete'])}</td></tr>"
            for q in quarters
        )
        body = (
            "<h2>Delivery Roadmap</h2>"
            f"<table><thead><tr><th>Quarter</th><th>Theme</th><th>Status</th></tr></thead><tbody>{rows}</tbody></table>"
            "<h2>Risks</h2><p>Resource contention and integration dependencies across shared services.</p>"
        )
    elif template == "api_spec":
        code = (
            "GET /api/v1/entities/{id}\n"
            "200: { id, status, owner, updatedAt }\n"
            "404: { error: 'Not found' }\n"
        )
        body = (
            "<h2>Contract</h2>"
            "<p>Versioned API contract with validation and structured error model.</p>"
            f"<pre><code class='language-http'>{code}</code></pre>"
        )
    elif template == "onboarding":
        checklist = "".join(
            f"<li>{task}</li>"
            for task in [
                "Provision repository and CI access",
                "Complete secure coding module",
                "Shadow incident review and deploy process",
                "Deliver first maintenance pull request",
            ]
        )
        body = (
            "<h2>First 30 Days Plan</h2>"
            f"<ul>{checklist}</ul>"
            "<h2>Knowledge Base</h2><p>Use related links below to discover architecture and operating procedures.</p>"
        )
    else:
        body = (
            "<h2>Design Review</h2><blockquote>Proposal reviewed with cross-functional stakeholders.</blockquote>"
            "<h2>Alternatives</h2><ul><li>Monolith extension</li><li>Service extraction</li><li>Hybrid caching strategy</li></ul>"
            f"<h2>Actions</h2><table><thead><tr><th>Action</th><th>Owner</th><th>Status</th></tr></thead><tbody>{action_rows}</tbody></table>"
        )

    return (
        f"<h1>{title}</h1>"
        f"<p><strong>Author:</strong> {author} | <strong>Parent Topic:</strong> {parent} | <strong>Template:</strong> {template}</p>"
        f"<p><b>Signal:</b> <em>{emphasis}</em> trajectory with <mark>{confidence}% confidence</mark>.</p>"
        "<details><summary><b>Operational Notes</b></summary>"
        f"<p>Use <kbd>Ctrl</kbd> + <kbd>K</kbd> to quickly search this space and review updates by <code>{author.lower().replace(' ', '.')}</code>.</p>"
        "</details>"
        "<hr/>"
        f"{body}"
        "<h2>Related Confluence Pages</h2>"
        f"<ul>{reference_links or '<li>None</li>'}</ul>"
        "<h2>Related Jira Issues</h2>"
        f"<ul>{issue_links or '<li>None</li>'}</ul>"
    )


def generate_confluence_pages(
    rng: random.Random,
    pages: int,
    issue_keys: list[str],
    now: datetime,
) -> list[dict]:
    page_docs: list[dict] = []
    start_id = 1000

    for i in range(pages):
        page_id = str(start_id + i)
        space = rng.choice(SPACES)
        parent = rng.choice(PARENT_TOPICS)
        author = rng.choice(AUTHORS)
        template = rng.choice(PAGE_TEMPLATES)
        title = f"{space} {template.replace('_', ' ').title()} Guide {page_id}"

        prior_page_ids = [doc["id"] for doc in page_docs]
        linked_page_ids = rng.sample(prior_page_ids, k=min(len(prior_page_ids), rng.randint(0, 3)))
        linked_issue_keys = rng.sample(issue_keys, k=min(len(issue_keys), rng.randint(1, 4)))

        html = build_confluence_html(
            rng=rng,
            title=title,
            author=author,
            parent=parent,
            template=template,
            linked_page_ids=linked_page_ids,
            linked_issue_keys=linked_issue_keys,
        )

        keywords = choose_keywords(rng, [space, parent, template])
        summary_source = f"{template} page for {space}. Links {len(linked_page_ids)} pages and {len(linked_issue_keys)} issues."
        page_docs.append(
            {
                "id": page_id,
                "space": space,
                "title": title,
                "author": author,
                "last_updated": (now - timedelta(days=rng.randint(0, 365))).strftime("%Y-%m-%d"),
                "parent_confluence_topic": parent,
                "keywords": keywords,
                "summary": summarize_text(summary_source),
                "_links": {
                    "self": f"/rest/api/content/{page_id}",
                    "webui": f"/wiki/spaces/{space}/pages/{page_id}",
                },
                "body": {"storage": {"value": html, "representation": "storage"}},
                "metadata": {
                    "template": template,
                    "linked_pages": linked_page_ids,
                    "linked_issues": linked_issue_keys,
                },
            }
        )

    return page_docs


def choose_issue_type(rng: random.Random, index: int) -> str:
    if index % 30 == 0:
        return "Epic"
    if index % 8 == 0:
        return "Bug"
    if index % 5 == 0:
        return "Story"
    return rng.choice(ISSUE_TYPES)


def issue_status_by_type(rng: random.Random, issue_type: str) -> str:
    if issue_type == "Bug":
        return rng.choice(["To Do", "In Progress", "In QA", "Done"])
    if issue_type == "Epic":
        return rng.choice(["To Do", "In Progress", "Done"])
    return rng.choice(["To Do", "In Progress", "Blocked", "Done"])


def build_issue_description(
    issue_key: str,
    project: str,
    issue_type: str,
    linked_page_ids: list[str],
    dependency_keys: list[str],
) -> str:
    page_refs = (
        "".join(
            f"<li><a href='/rest/api/content/{page_id}'>{project}-DOC-{page_id}</a></li>"
            for page_id in linked_page_ids
        )
        or "<li>None</li>"
    )
    deps = "".join(f"<li><code>{dep}</code></li>" for dep in dependency_keys) or "<li>None</li>"
    return (
        f"<p><b>Issue</b> <code>{issue_key}</code> belongs to <strong>{project}</strong> as a <em>{issue_type}</em>.</p>"
        "<h4>Traceability</h4>"
        f"<ul>{page_refs}</ul>"
        "<h4>Dependencies</h4>"
        f"<ul>{deps}</ul>"
        "<details><summary><b>Acceptance Criteria</b></summary>"
        "<ol><li>Update tests and fixtures.</li><li>Include telemetry notes.</li><li>Document rollout and rollback plan.</li></ol>"
        "</details>"
    )


def generate_jira_issues(
    rng: random.Random,
    issues: int,
    page_ids: list[str],
    now: datetime,
) -> list[dict]:
    docs: list[dict] = []
    next_issue_id = 20001
    global_issue_counter = 100
    project_counters = {project: 100 for project in SPACES}
    epic_keys_by_project: dict[str, list[str]] = {project: [] for project in SPACES}

    for index in range(issues):
        issue_id = str(next_issue_id + index)
        project = SPACES[index % len(SPACES)]
        project_counters[project] += 1
        global_issue_counter += 1
        issue_key = f"{JIRA_PROJECT_KEY}-{global_issue_counter}"
        issue_type = choose_issue_type(rng, index)
        status = issue_status_by_type(rng, issue_type)
        priority = ISSUE_PRIORITIES[min(rng.randint(0, 100) // 30, len(ISSUE_PRIORITIES) - 1)]
        reporter = rng.choice(AUTHORS)
        assignee = rng.choice(AUTHORS)
        created_days = rng.randint(30, 450)
        updated_days = max(0, created_days - rng.randint(0, 30))
        created_at = iso_datetime(now, created_days)
        updated_at = iso_datetime(now, updated_days)
        linked_page_ids = rng.sample(page_ids, k=min(len(page_ids), rng.randint(0, 3)))
        previous_keys = [doc["key"] for doc in docs]
        dependency_keys = rng.sample(previous_keys, k=min(len(previous_keys), rng.randint(0, 2)))

        if issue_type == "Epic":
            epic_keys_by_project[project].append(issue_key)

        epic_link = ""
        if issue_type in {"Story", "Task", "Improvement", "Bug"} and epic_keys_by_project[project]:
            epic_link = rng.choice(epic_keys_by_project[project])

        comments = []
        for comment_index in range(rng.randint(1, 4)):
            mentions = rng.sample(previous_keys, k=min(len(previous_keys), rng.randint(0, 2)))
            linked_mentions = " ".join(f"<a href='/rest/api/2/issue/{value}'>{value}</a>" for value in mentions)
            comments.append(
                {
                    "id": f"{issue_id}-{comment_index}",
                    "author": {"displayName": rng.choice(AUTHORS)},
                    "body": (
                        f"<p><b>Auto comment {comment_index}</b> for <code>{issue_key}</code>.</p>"
                        f"<p>Validated logs and rollout checklist. <em>{linked_mentions or 'No linked mentions.'}</em></p>"
                    ).strip(),
                    "created": iso_datetime(now, rng.randint(0, 365)),
                }
            )

        subtasks = []
        if issue_type in {"Story", "Task"} and rng.random() < 0.3:
            for subtask_index in range(rng.randint(1, 3)):
                subtask_id = f"{issue_id}-sub{subtask_index + 1}"
                global_issue_counter += 1
                subtask_key = f"{JIRA_PROJECT_KEY}-{global_issue_counter}"
                subtasks.append(
                    {
                        "id": subtask_id,
                        "key": subtask_key,
                        "fields": {
                            "summary": f"Subtask {subtask_index + 1} for {issue_key}",
                            "issuetype": {"name": "Sub-task"},
                            "status": {"name": rng.choice(["To Do", "In Progress", "Done"])}
                        },
                    }
                )

        issue_links = []
        for dep_key in dependency_keys:
            issue_links.append(
                {
                    "type": {"name": "Blocks", "outward": "blocks", "inward": "is blocked by"},
                    "outwardIssue": {"key": dep_key},
                }
            )

        summary = f"[{project}] {issue_type} work item {issue_id}"
        description = build_issue_description(
            issue_key=issue_key,
            project=project,
            issue_type=issue_type,
            linked_page_ids=linked_page_ids,
            dependency_keys=dependency_keys,
        )

        issue_doc = {
            "id": issue_id,
            "key": issue_key,
            "self": f"/rest/api/2/issue/{issue_id}",
            "fields": {
                "project": {"key": project},
                "summary": summary,
                "description": description,
                "issuetype": {"name": issue_type},
                "status": {"name": status},
                "priority": {"name": priority},
                "reporter": {"displayName": reporter},
                "assignee": {"displayName": assignee},
                "creator": {"displayName": reporter},
                "created": created_at,
                "updated": updated_at,
                "resolutiondate": updated_at if status == "Done" else None,
                "labels": rng.sample(LABELS_POOL, k=rng.randint(1, 4)),
                "components": rng.sample(COMPONENTS_POOL, k=rng.randint(0, 3)),
                "fixVersions": [] if rng.random() < 0.6 else [f"v{rng.randint(1, 5)}.{rng.randint(0, 9)}"],
                "comment": {"comments": comments},
                "subtasks": subtasks,
                "issuelinks": issue_links,
                "customfield_10014": epic_link,
                "customfield_10016": rng.choice([1, 2, 3, 5, 8, 13]),
                "environment": rng.choice(["dev", "staging", "production"]),
            },
            "_links": {
                "webui": f"/rest/api/2/issue/{issue_key}",
                "related_pages": [f"/rest/api/content/{page_id}" for page_id in linked_page_ids],
            },
        }
        docs.append(issue_doc)

    return docs


def generate_dataset(pages: int, issues: int, seed: int | None = None) -> tuple[list[dict], list[dict]]:
    rng = random.Random(seed)
    now = utc_now()
    synthetic_issue_keys = [f"{JIRA_PROJECT_KEY}-{100 + i + 1}" for i in range(issues)]
    pages_docs = generate_confluence_pages(rng=rng, pages=pages, issue_keys=synthetic_issue_keys, now=now)
    page_ids = [doc["id"] for doc in pages_docs]
    issues_docs = generate_jira_issues(rng=rng, issues=issues, page_ids=page_ids, now=now)
    return pages_docs, issues_docs


def ensure_generated_data(
    pages: int = DEFAULT_PAGES,
    issues: int = DEFAULT_ISSUES,
    seed: int | None = None,
) -> tuple[list[dict], list[dict]]:
    global _DATASET_CACHE
    if _DATASET_CACHE:
        same_shape = (
            _DATASET_CACHE.get("pages") == pages
            and _DATASET_CACHE.get("issues") == issues
            and _DATASET_CACHE.get("seed") == seed
        )
        if same_shape:
            return _DATASET_CACHE["pages_docs"], _DATASET_CACHE["issues_docs"]

    pages_docs, issues_docs = generate_dataset(pages=pages, issues=issues, seed=seed)
    _DATASET_CACHE = {
        "pages": pages,
        "issues": issues,
        "seed": seed,
        "pages_docs": pages_docs,
        "issues_docs": issues_docs,
    }
    return pages_docs, issues_docs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=DEFAULT_PAGES, help="Number of Confluence pages to create")
    parser.add_argument("--issues", type=int, default=DEFAULT_ISSUES, help="Number of Jira issues to create")
    parser.add_argument("--seed", type=int, default=None, help="Optional deterministic random seed")
    args = parser.parse_args()

    pages_docs, issues_docs = generate_dataset(
        pages=args.pages,
        issues=args.issues,
        seed=args.seed,
    )
    print(f"Generated {len(pages_docs)} Confluence pages in memory")
    print(f"Generated {len(issues_docs)} Jira issues in memory")


if __name__ == "__main__":
    main()
