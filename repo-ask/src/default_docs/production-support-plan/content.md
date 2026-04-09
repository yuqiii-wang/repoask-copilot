# Production Support Plan Skill

## Configuration

### Environment Base URLs

| Environment | Base URL |
|-------------|----------|
| local | `http://127.0.0.1:8093/logTail` |

> To add environments, extend this table (e.g. `staging`, `prod`).

### Available Logs (Reference Only)

Log file URLs follow the pattern: `{base_url}/{prefix}?file={prefix}-{timestamp}.log`  
List files for a component: `{base_url}/{prefix}?list`  
Timestamp format: `YYYYMMDDHHmm`

> **Important:** The table below is a documentation reference only. The **authoritative source of log prefix names is the runtime `## Available Log Listing`** injected into the session from the logtail server. Always use prefix values from that runtime listing — never invent or copy names from this table.

| Prefix | Description |
|--------|-------------|
| `trading-system` | Core OMS and order-lifecycle events — order submissions, fills, cancellations, and routing decisions. |
| `error-scenarios` | Captured operational failure scenarios — unhandled exceptions, validation rejections, and system fault injections. |
| `settlement-processing` | Trade settlement lifecycle — cash movements, custody reconciliation, and ledger commit confirmations. |
| `risk-management` | Portfolio risk metrics and limit checks — VaR calculations, stress-test results, concentration breaches, and counterparty exposure. |
| `market-data-sync` | Market data ingestion pipeline — equity quotes, FX rates, index snapshots, and pricing feed health. |

---

## When to Use

- A production incident needs investigation and you are at the **beginning** of triage.
- Your job is to produce a **keyword + log proposal** only. A static tool (`build_plan.py`) will assemble the full `scan_tasks` JSON from your proposal.

## Proposal Format

Your output must be **only** the following JSON object — do **NOT** include `scan_tasks`, `log_url`, or `time_ranges`:

```json
{
  "incident_summary": "<one-sentence description>",
  "environment": "<environment>",
  "original_query": "<verbatim user query>",
  "incident_time": "<YYYYMMDDHHmm compact timestamp if mentioned in query, or null>",
  "extracted_identifiers": ["US0378331005"],
  "proposed_keywords": ["isin", "fill", "settlement", "/settlements/"],
  "proposed_logs": {
    "trading-system": {
      "order-lifecycle": { "start": "2026-04-01T09:00:00Z", "end": "2026-04-01T13:00:00Z" }
    },
    "settlement-processing": {
      "settlement": { "start": "2026-04-01T09:00:00Z", "end": "2026-04-01T17:00:00Z" }
    }
  }
}
```

**`incident_time`** — compact `YYYYMMDDHHmm` timestamp extracted verbatim from the user query (e.g. `202604010930`). Set to `null` if no specific time was mentioned. Used as the fallback time window when a category's `start`/`end` is unknown.

**`proposed_logs`** — an object whose **keys are exact prefix values from the runtime `## Available Log Listing`** (never from local config). Each value maps category labels to `{start, end}` ISO-8601 time windows covering the relevant incident period. Set `start`/`end` to `null` when the window is unknown; `build_plan.py` will use `incident_time` or the log file's own timestamp instead.

**`proposed_keywords`** — ONLY from these two sources:
1. Meaningful tokens taken verbatim from `original_query` (the user's exact words, e.g. `isin`, `trade`, `settlement`).
2. Literal string fragments from the project source code: first-argument strings of `logger.error(`, `logger.warn(`, `throw new …Exception("…")`, and `@RequestMapping` / `@GetMapping` / `@PostMapping` route path values.

Do **NOT** invent, guess, or add any word that is not literally present in one of these two sources. No domain assumptions, no synonyms, no extra context.

**`proposed_logs`** — choose from the `prefix` values listed under **`## Available Log Listing`** that are relevant to the incident. Use only the exact prefix strings present in the listing.

**`extracted_identifiers`** — raw sensitive tokens from `original_query` (e.g. ISINs, trade IDs); `main.py` validates and converts them with `guess_pattern()` before scanning.

---

## Workflow

### Step 1 — Select Relevant Logs and Optionally Check Internal Docs

The available log files have already been fetched from the logtail server and injected into this session under **`## Available Log Listing`** (a JSON array with `prefix`, `summary`, and `available: [{timestamp, url}]` per entry). Use those URLs directly in `scan_tasks` — do **not** run `scripts/urls.py` yourself.

If `## Available Log Listing` is absent or empty, the logtail server is unreachable. In that case skip log scanning entirely and fall back to a plain doc search — answer the user's question directly as if `@repoask` was invoked with no plan context:

```python
repoask_doc_check(searchTerms=[<key terms from user query>], mode="id_2_metadata_4_summary", limit=5)
```

Return a natural-language answer based on matching docs. Do not emit a plan JSON or proceed to Step 2.

Optionally run `repoask_doc_check` for related runbooks (when server is available):

```python
repoask_doc_check(searchTerms=[<key terms from user query>], mode="id_2_metadata_4_summary", limit=5)
```

Include relevant docs in `related_docs`; omit if none found.

---

### Step 2 — Emit Your Proposal

Present your chosen keywords and log prefixes to the user so they can review them, then emit **only** the JSON object from the Proposal Format above (with real values substituted).

Do **NOT** emit `scan_tasks`, `log_url`, or `time_ranges` — `build_plan.py` assembles those automatically from your proposal and the available log listing.
