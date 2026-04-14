---
name: production-support-plan-skill
description: Pre-investigation planning: calls list_log_descriptions() to discover available logs and their summaries, optionally searches internal docs via repoask_doc_check, selects relevant services, interprets the time window, and presents a human-reviewable scan plan. The user approves the plan to trigger production-support-main.
---

# Production Support Plan Skill

Source ID: production-support-plan
Author: Platform Engineering
Last Updated: 2026-04-02
Parent Topic: 

## Skill Instructions
Use the following document content as a reference skill or knowledge base for completing tasks.

## Content
# Production Support Plan Skill

## Configuration

### Log Sources

This skill supports two log query backends:

1. **Logtail Server (Legacy)** — Individual log file queries
   - Environment base URLs populated at runtime from `data/logs.csv`
   - Log file pattern: `{base_url}/{prefix}?file={prefix}-{timestamp}.log`
   - Timestamp format: `YYYYMMDDHHmm`

2. **Loki (Recommended)** — Unified log aggregation with LogQL
   - Loki API: `http://localhost:8094` (configurable)
   - Uses LogQL stream selectors: `{job="app-logs"}`
   - Native ISO-8601 timestamps
   - Aggregates across all log streams automatically

> **Do NOT use any hardcoded prefix or stream names.** The available log sources are discovered at runtime and injected into this session under **`## Available Log Listing`** or **`## Available Loki Streams`**. Always refer exclusively to the identifiers present in that listing. If the listing is absent, skip log scanning entirely (see Step 1 fallback).

---

## When to Use

- A production incident needs investigation and you are at the **beginning** of triage.
- Your job is to produce a **keyword + log proposal** only. A static tool (`build_plan.py`) will assemble the full `scan_tasks` JSON from your proposal.

## Proposal Format

Your output must be **only** the following JSON object — do **NOT** include `scan_tasks`, `log_url`, or `time_ranges`:

```json
{
  "incident_summary": "<one-sentence description of the incident>",
  "environment": "<environment-name from Available Log Listing>",
  "original_query": "<verbatim user query>",
  "incident_time": "<YYYYMMDDHHmm compact timestamp if mentioned in query, or null>",
  "extracted_identifiers": ["<raw-identifier-from-query e.g. trade-id, ISIN>"],
  "proposed_keywords": ["<token-from-query>", "<log-message-literal-from-source-code>"],
  "proposed_logs": {
    "<prefix-from-available-log-listing>": {
      "<category-label>": { "start": "<ISO-8601-start>", "end": "<ISO-8601-end>" }
    }
  }
}
```

**`incident_time`** — compact `YYYYMMDDHHmm` timestamp extracted verbatim from the user query (e.g. `<YYYYMMDDHHmm-from-query>`). Set to `null` if no specific time was mentioned. Used as the fallback time window when a category's `start`/`end` is unknown.

**`proposed_logs`** — an object whose **keys are exact prefix values from the runtime `## Available Log Listing`** (never from local config). Each value maps category labels to `{start, end}` ISO-8601 time windows covering the relevant incident period. Set `start`/`end` to `null` when the window is unknown; `build_plan.py` will use `incident_time` or the log file's own timestamp instead.

**`proposed_keywords`** — ONLY from these two sources:
1. Meaningful tokens taken verbatim from `original_query` (the user's exact words, e.g. `<noun-phrase-from-query>`, `<route-path-from-query>`).
2. Literal string fragments from the project source code: first-argument strings of `logger.error(`, `logger.warn(`, `throw new …Exception("…")`, and `@RequestMapping` / `@GetMapping` / `@PostMapping` route path values.

Do **NOT** invent, guess, or add any word that is not literally present in one of these two sources. No domain assumptions, no synonyms, no extra context.

**`proposed_logs`** — choose from the `prefix` values listed under **`## Available Log Listing`** that are relevant to the incident. Use only the exact prefix strings present in the listing.

**`extracted_identifiers`** — raw sensitive tokens from `original_query` (e.g. `<ISIN-from-query>`, `<trade-id-from-query>`); `main.py` validates and converts them with `guess_pattern()` before scanning.

---

## Workflow

### Step 1 — Discover Available Log Sources

The system automatically discovers available log sources and injects them into this session:

**For Loki (current default):**
- Stream selectors are provided under **`## Available Loki Streams`**
- Each stream has: `selector` (LogQL expression), `labels`, and `summary`
- Use the exact `selector` values in your proposal

**For Logtail Server (legacy):**
- Log files are listed under **`## Available Log Listing`**
- Each entry has: `prefix`, `summary`, and `available: [{timestamp, url}]`
- Use the exact `prefix` values in your proposal

If neither listing is present, the log backend is unreachable. In that case skip log scanning entirely and fall back to a plain doc search — answer the user's question directly as if `@repoask` was invoked with no plan context:

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
