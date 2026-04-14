# Production Support Main Skill

## Purpose

Given a resolved plan from `production-support-plan`, this skill:
1. Executes `query_logs.py` against logtail / Loki — returning **timestamps, log level, and class name only** (no raw log lines)
2. Cross-references hit timestamps with project source code to identify the root cause
3. Summarises findings and asks the user: **next round** or **check code logic**?

---

## Privacy Constraint

Raw log message content must never be read directly.  Instead, run `query_logs.py` to obtain a keyword **presence distribution** (timestamps + log level + class name only), then correlate with workspace source code to reason about what happened.

---

## Scripts

Located in `scripts/` next to this file.  Run every script as a **module** from the skill root directory (the directory containing `scripts/`):

```bash
cd <skill-root>           # directory containing scripts/
python -m scripts.query_logs --plan plan.json
```

| File | Purpose |
|---|---|
| `query_logs.py` | **Entry point** — reads a plan JSON, queries all sources, outputs presence distribution |
| `_logtail_query.py` | Fetches logtail lines filtered by time window + keyword |
| `_loki_query.py` | Queries Loki `query_range` API with a LogQL regex filter |
| `_log_parser.py` | Parses Java log lines → `{ts_iso, level, class_name}`; folds consecutive duplicates |
| `.env.example` | Credentials template — copy to `.env` and fill in |

---

## Input Contract

Receive the plan JSON produced by `build_plan.py`.  The key field is the **`logs` array** — each entry is fully self-contained (real URL, real time range, ready to execute):

```json
{
  "incident_summary": "...",
  "environment": "local",
  "original_query": "...",
  "incident_time": "YYYYMMDDHHmmss or null",
  "time_range": { "start": "YYYY-MM-DD HH:MM:SS.000", "end": "YYYY-MM-DD HH:MM:SS.999" },
  "extracted_identifiers": ["US0378331005"],
  "keywords": ["timeout", "order rejected"],
  "logs": [
    {
      "type": "logtail",
      "url": "https://127.0.0.1:8093/logTail/trading-system?file=trading-system-20260411141244484.log",
      "time_range": { "start": "2026-04-11 11:42:00.000", "end": "2026-04-11 14:41:59.999" },
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
    "CA_BUNDLE": ""
  }
}
```

---

## Workflow

### Step 1 — Run `query_logs.py`

```bash
python -m scripts.query_logs --plan plan.json [--out result.json]
```

`query_logs.py` iterates over `plan["logs"]` and for each entry:

- **logtail**: appends `&f=HH:MM&t=HH:MM&i=<keyword>` to the file URL and fetches the server-filtered plain-text response.
- **loki**: calls `/loki/api/v1/query_range` with LogQL `{stream_selector}|~"(?i)<keyword>"`.

For each line returned it extracts `{timestamp_iso, level, class_name}` — message content is discarded.  Consecutive entries with the same `(level, class_name)` are folded into a single string with `(xN times)`.

### Step 2 — Interpret the Presence Distribution

`query_logs.py` outputs a JSON array:

```json
[
  {
    "url": "https://127.0.0.1:8093/logTail/trading-system?file=trading-system-20260411141244484.log",
    "keywords": {
      "timeout": [
        "2026-04-11T11:42:00Z [WARN][MarketDataRestClient]",
        "2026-04-11T11:42:00Z [WARN][MarketDataService] (x4 times)",
        "2026-04-11T11:44:00Z [ERROR][OmsService]"
      ],
      "order rejected": []
    }
  },
  {
    "stream_selector": "{job=\"app-logs\",component=\"trading-system\"}",
    "keywords": {
      "timeout": [
        "2026-04-11T11:42:30Z [WARN][MarketDataRestClient]"
      ],
      "order rejected": []
    }
  }
]
```

Use the class names and timestamps to locate the relevant source files and methods in the workspace, then reason about the failure mode.

### Step 3 — Propose Next Round or Conclude

After analysing:

- **Next round**: build a new `"logs"` array with refined keywords or a narrower time window and re-run `query_logs.py`.
- **Root cause found**: present a concise summary to the user:
  - What happened (class names + timeline)
  - Which source code area to inspect
  - Recommended fix or next investigation step

---

## Credentials

Copy `scripts/.env.example` to `scripts/.env` and fill in credentials before running:

```
LOG_API_KEY=          # Bearer token (preferred)
LOG_USERNAME=         # HTTP Basic auth fallback
LOG_PASSWORD=
CA_BUNDLE=            # Path to CA bundle PEM for internal HTTPS servers
                      # Local logtail dev cert: <repo>/dummy-data-for-test/certs/logtail.crt
```

Credentials are loaded automatically from `scripts/.env` at startup.

---

## Log Tail Search URL Parameters

`/logTail/{component}?file={filename}` accepts:

| Param | Format | Effect |
|---|---|---|
| `f` | `HH:MM` | From time (inclusive) |
| `t` | `HH:MM` | To time (inclusive) |
| `i` | text | Include only lines containing this (case-insensitive) |
| `e` | text | Exclude lines containing this |
| `n` | integer | Return last N lines (applied after time filter) |

Example: `?file=trading-system-20260411141244484.log&f=11:42&t=14:42&i=timeout`

---
