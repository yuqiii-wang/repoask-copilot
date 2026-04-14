# Production Support Plan Skill

## Purpose

Given a user's incident query (e.g. *"check USXXX123 timeout"*), this skill:
1. Discovers what log files and Loki streams are available right now
2. Understands the query to pick relevant sources and keywords
3. Proposes a **search template** — which sources to query, which time range to cover, which keywords to search — **without executing anything**

The template is then resolved by `build_plan.py` into a concrete **`logs` array** — with real URLs, time ranges, and keywords filled in — which `production-support-main` executes.

---

## Log Sources Configuration

Configured in `data/logs.csv` (`environment|type|tags|base_url|summary`):

| type | tags | How it is used |
|---|---|---|
| `logtail` | e.g. `trading-system` | List URL: `{base_url}/{component}?list` → HTML `<ul>` of `?file={name}.log` links |
| `loki` | e.g. `app-logs` (the Loki `job` label) | Loki server root (from base_url); source `tags` become `component` labels → `{job="{csv-tags}",component="{source-tag}"}` |

Filenames use a 14-digit millisecond timestamp (`YYYYMMDDHHmmss`). `build_plan.py` filters files to those within the incident window automatically.

> **Never hardcode source names.** Always use identifiers from the runtime **Available Logtail Listing** and **Available Loki Streams** injected into the session.

---

## Search Template Format

Your output must be **only** this JSON:

```json
{
  "incident_summary": "<one sentence>",
  "environment": "<from Available Logtail Listing>",
  "original_query": "<verbatim user query>",
  "incident_time": "YYYYMMDDHHmmss or null",
  "extracted_identifiers": ["<order-id>", "<symbol>"],
  "sources": [
    {
      "type": "logtail",
      "tags": ["<component-prefix from ?list>"],
      "keywords": ["<keyword1>", "<keyword2>"],
      "start_time": "YYYYMMDDHHmmss",
      "end_time": "YYYYMMDDHHmmss"
    },
    {
      "type": "loki",
      "tags": ["<component label from Loki streams, e.g. trading-system>"],
      "keywords": ["<keyword1>", "<keyword2>"],
      "start_time": "YYYYMMDDHHmmss",
      "end_time": "YYYYMMDDHHmmss"
    }
  ]
}
```

---

## Workflow

### Step 1 — Discover Available Sources

Before building the template, inspect what is currently available:

**Logtail** — list all components and their log files:
```
GET https://127.0.0.1:8093/logTail              → HTML list of component list-URLs
GET https://127.0.0.1:8093/logTail/{component}?list  → HTML list of log file URLs
```

Each file URL is of the form:
```
https://127.0.0.1:8093/logTail/{component}?file={component}-{YYYYMMDDHHmmssSSS}.log
```

The 17-digit suffix is the file creation timestamp (`YYYYMMDD HHmmss SSS`).

**Loki** — list available stream labels:
```
GET http://127.0.0.1:8094/loki/api/v1/labels
GET http://127.0.0.1:8094/loki/api/v1/label/job/values
GET http://127.0.0.1:8094/loki/api/v1/label/component/values
```

This information is injected into the session as **Available Logtail Listing** and **Available Loki Streams**. **Never invent source names or tags** — only use identifiers seen in these listings.

---

### Step 2 — Interpret the Query

Extract from the user's natural-language query:

| Field | How to derive |
|---|---|
| `incident_time` | Any time hint ("10:45", "this morning", "Apr 11"); convert to `YYYYMMDDHHmmss`; use current time if absent |
| `start_time` | `incident_time` minus a safety margin (default: 3 hours before) |
| `end_time` | `incident_time` plus a look-ahead (default: 1 hour after) |
| `extracted_identifiers` | Order IDs, ISINs, account numbers, trade IDs visible in the query |
| `keywords` | Technical terms that imply the failure mode (`timeout`, `rejected`, `exception`, symbol name, order ID prefix) |
| `tags` | Component names from the Logtail listing or Loki stream labels that are likely involved |

Include **both** `logtail` and `loki` source entries when both source types are available for the same component.

---

### Step 3 — Run `build_plan.py`

```bash
python scripts/build_plan.py --template template.json --out plan.json
```

`build_plan.py` does the following:

1. Loads `scripts/logs.csv` to resolve `environment + type + tag → base_url`.
2. **Logtail**: calls `{base_url}/{tag}?list`, parses the HTML `<a href>` list, and keeps only files whose filename timestamp falls within `[start_time − 3h, end_time]`.
3. **Loki**: constructs `{job="{csv_row_tags}",component="{source_tag}"}` stream selector — `job` comes from the `logs.csv` row's `tags` column (e.g. `app-logs`); `component` is each entry in the template source's `tags` list (e.g. `trading-system`).
4. Outputs the resolved plan JSON.

> If `plan["logs"]` is empty, widen `start_time`/`end_time` or check that the component tag matches the listing exactly.

---

### Step 4 — Present the Plan for Review

Show the user a summary before handing off to `production-support-main`:

- `incident_summary`
- Global `time_range`
- List of logtail file URLs selected (filename only is enough)
- Loki stream selectors
- Full `keywords` list

Ask for confirmation. If the user wants to adjust keywords or the time window, update the template and re-run `build_plan.py`.

---

## Resolved Plan Format (output of `build_plan.py`)

```json
{
  "incident_summary": "...",
  "environment": "local",
  "original_query": "...",
  "incident_time": "YYYYMMDDHHmmss or null",
  "time_range": { "start": "YYYY-MM-DD HH:MM:SS.000", "end": "YYYY-MM-DD HH:MM:SS.000" },
  "extracted_identifiers": ["US0378331005"],
  "keywords": ["timeout", "order rejected"],
  "logs": [
    {
      "type": "logtail",
      "url": "https://127.0.0.1:8093/logTail/trading-system?file=trading-system-20260411141244484.log",
      "time_range": { "start": "2026-04-11 11:42:00.000", "end": "2026-04-11 14:41:59.000" },
      "keywords": ["timeout", "order rejected"]
    },
    {
      "type": "loki",
      "stream_selector": "{job=\"app-logs\",component=\"trading-system\"}",
      "loki_url": "http://127.0.0.1:8094",
      "start_iso": "2026-04-11T11:42:00Z",
      "end_iso": "2026-04-11T14:41:59Z",
      "keywords": ["timeout", "order rejected"]
    }
  ],
  "extra": {
    "CA_BUNDLE": "..."
  }
}
```

Pass this JSON directly to `production-support-main` as the plan input.
