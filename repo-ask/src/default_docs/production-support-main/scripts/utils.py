"""
utils.py — Log-search utilities used by main.py.

Provides:
  ScanTask                  NamedTuple representing one atomic scan unit
  validate_tokenized_query  Injection-guard: verify tokens against original query
  scan_log                  Async POST for a single ScanTask
  scan_all                  Async pool: launch all ScanTasks concurrently
  merge_hits                Flatten per-task results into keyword -> [timestamps]
  build_tasks_from_plan     Expand a production-support-plan JSON into ScanTask list
  build_tasks_from_args     Build ScanTask list from flat CLI args (fallback)

Import only — run main.py as the sole entry-point script.
"""

import asyncio
import json
import re
import sys
from datetime import datetime, timedelta
from typing import Any, NamedTuple
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import httpx

from rules import COMMON_ERROR_WORDS, guess_pattern, tokenize_query
from keyword_filter import filter_keywords

_TIMEOUT = httpx.Timeout(30.0, connect=5.0)
_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})")
_TS_FMT = "%Y-%m-%d %H:%M:%S.%f"


def _default_time_range(lookback_minutes: int = 120) -> tuple[str, str]:
    """Return (start, end) strings covering the last *lookback_minutes* up to now (UTC)."""
    now = datetime.utcnow().replace(microsecond=0)
    start = now - timedelta(minutes=lookback_minutes)
    return (
        start.strftime("%Y-%m-%d %H:%M:%S.000"),
        now.strftime("%Y-%m-%d %H:%M:%S.999"),
    )


# ---------------------------------------------------------------------------
# ScanTask — one atomic unit of work dispatched to the async pool
# ---------------------------------------------------------------------------

class ScanTask(NamedTuple):
    """One (log, window, keywords) triplet dispatched to the async pool."""
    log_url: str
    start: str
    end: str
    words: list[str]
 

def _task_key(task: ScanTask) -> str:
    """Stable dict key for the results map."""
    return f"{task.log_url}[{task.start}~{task.end}]"


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------

def validate_tokenized_query(
    tokens: list[str], original_query: str
) -> tuple[list[str], list[str]]:
    """
    Verify each *token* appears literally (case-insensitive) in *original_query*.

    Returns (valid_tokens, rejected_tokens).  Only valid tokens are safe to
    forward; rejected ones are dropped and reported as warnings so the LLM
    cannot inject arbitrary identifiers.
    """
    valid: list[str] = []
    rejected: list[str] = []
    for tok in tokens:
        if tok.lower() in original_query.lower():
            valid.append(tok)
        else:
            rejected.append(tok)
    return valid, rejected


# ---------------------------------------------------------------------------
# Core async scan
# ---------------------------------------------------------------------------

def _log_name_from_url(url: str) -> str:
    """Extract the log filename from a log URL.

    Supports the new component-based URL:
        http://host/logTail/{component}?file={filename}
    as well as the legacy path-based URL:
        http://host/api/logs/{filename}
    """
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "file" in qs:
        return qs["file"][0]
    return parsed.path.rstrip("/").split("/")[-1]


def _build_search_url(log_url: str, word: str, start: str, end: str) -> str:
    """Build a fully-encoded search URL using the short query params (i, f, t)."""
    parsed = urlparse(log_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["i"] = [word]
    # Extract HH:MM from full datetime strings like "2026-04-01 09:00:00.000"
    params["f"] = [start[11:16]] if len(start) >= 16 else [start]
    params["t"] = [end[11:16]]   if len(end)   >= 16 else [end]
    new_query = urlencode({k: v[0] for k, v in params.items()})
    return urlunparse(parsed._replace(query=new_query))


async def _search_word(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    log_url: str,
    word: str,
    start: str,
    end: str,
) -> tuple[str, list[str]]:
    """GET fully-encoded search URL — returns (word, [timestamps])."""
    url = _build_search_url(log_url, word, start, end)
    try:
        async with sem:
            resp = await client.get(url, timeout=_TIMEOUT)
    except (httpx.TransportError, httpx.TimeoutException) as exc:
        print(f"WARN: search failed for {url!r} word={word!r}: {exc}", file=sys.stderr)
        return word, []

    if resp.status_code == 404:
        return word, []  # no matches — server returns 404 when keyword not found

    if resp.status_code != 200:
        print(f"WARN: HTTP {resp.status_code} for {log_url!r} word={word!r}", file=sys.stderr)
        return word, []

    timestamps: list[str] = []
    for line in resp.text.splitlines():
        hit = _TS_RE.match(line)
        if hit:
            timestamps.append(hit.group(1))
    return word, timestamps


async def scan_log(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    task: ScanTask,
) -> dict[str, Any]:
    """
    Search all words in *task* against the log in parallel.

    Fires one GET per word to ``{log_url}/search`` and collects timestamps. 
    Returns ``{word: [timestamps]}``; never raises.
    """
    word_results = await asyncio.gather(
        *[_search_word(client, sem, task.log_url, w, task.start, task.end) for w in task.words]
    )
    return {word: ts for word, ts in word_results}


async def scan_all(tasks: list[ScanTask]) -> dict[str, dict[str, Any]]:
    """
    Launch every ScanTask in a single async p ool and await all results.

    Each task fires one GET per keyword against its log URL — all in parallel.
    Returns a dict keyed by ``"{log_url}[{start}~{end}]"``.
    """
    sem = asyncio.Semaphore(5)
    # Use explicit transport to bypass system proxy settings (which can return 502 for localhost)
    async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport()) as client:
        results = await asyncio.gather(
            *[scan_log(client, sem, task) for task in tasks]
        )
    return {_task_key(task): result for task, result in zip(tasks, results)}


# ---------------------------------------------------------------------------
# Merge helper
# ---------------------------------------------------------------------------

def merge_hits(results: dict[str, dict[str, Any]]) -> dict[str, dict[str, list[str]]]:
    """
    Flatten per-task results into log file -> keyword -> sorted timestamp list.
    """
    merged: dict[str, dict[str, list[str]]] = {}
    for task_key, hit_map in results.items():
        if "_error" in hit_map:
            print(
                f"WARN: scan failed for {task_key!r}: {hit_map['_error']}",
                file=sys.stderr,
            )
            continue
            
        # extract log URL by splitting on '['
        log_url = task_key.split('[')[0]
        # extract filename from the URL (handles both ?file= and path-based forms)
        log_name = _log_name_from_url(log_url)
        
        if log_name not in merged:
            merged[log_name] = {}
            
        for keyword, timestamps in hit_map.items():
            if "_error" in keyword:  # skip error keys just in case
                continue
            if not isinstance(timestamps, list):
                continue
            merged[log_name].setdefault(keyword, []).extend(timestamps)

    for log_name, kws in merged.items():
        for kw in kws:
            merged[log_name][kw] = sorted(set(merged[log_name][kw]))

    return merged


# ---------------------------------------------------------------------------
# Task builders
# ---------------------------------------------------------------------------

def _dedup(words: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for w in words:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def _resolve_identifiers(
    identifiers: list[str], original_query: str
) -> list[str]:
    """
    Validate identifiers against original_query and return safe raw values.

    Each token must appear literally in original_query (injection guard).
    Returns only the validated raw token strings for use as search terms.
    """
    if not identifiers:
        return []
    valid, rejected = validate_tokenized_query(identifiers, original_query)
    if rejected:
        print(
            f"WARN: identifiers not found in original_query, dropped: {rejected}",
            file=sys.stderr,
        )
    return valid


def build_tasks_from_plan(
    plan: dict,
    seed: bool = False,
    source_dir: "str | None" = None,
) -> list[ScanTask]:
    """
    Expand a production-support-plan JSON into a flat list of ScanTask objects.

    For each entry in plan["scan_tasks"] × its time_ranges one ScanTask is
    produced.  ``seed=True`` prepends COMMON_ERROR_WORDS to every task's word
    list.  ``extracted_identifiers`` are validated against ``original_query``
    and appended as raw search terms.

    ``source_dir`` enables keyword validation: words not traceable to the
    original_query or project source code literals are dropped before scanning.
    """
    original_query = plan.get("original_query", "")
    identifier_words = _resolve_identifiers(
        plan.get("extracted_identifiers", []), original_query
    )
    # Plan-level keywords from the populated plan template (explicit fallback /
    # supplement to scan_tasks[].words which were embedded by build_plan.py).
    plan_level_keywords: list[str] = list(plan.get("proposed_keywords", []))

    tasks: list[ScanTask] = []
    for entry in plan.get("scan_tasks", []):
        base_words: list[str] = []
        if seed:
            base_words.extend(COMMON_ERROR_WORDS)
        base_words.extend(entry.get("words", []))
        seen = set(base_words)
        # Merge in plan-level proposed_keywords so the populated plan output
        # always feeds the log screener even if scan_tasks.words differ.
        for kw in plan_level_keywords:
            if kw not in seen:
                base_words.append(kw)
                seen.add(kw)
        for tok in identifier_words:
            if tok not in seen:
                base_words.append(tok)
                seen.add(tok)

        # Filter out hallucinated keywords: keep only words from query or code
        non_seed = [w for w in base_words if w not in COMMON_ERROR_WORDS]
        kept, dropped = filter_keywords(non_seed, original_query, source_dir)
        if dropped:
            print(
                f"WARN: keywords removed (not in query or code): {dropped}",
                file=sys.stderr,
            )
        seed_words = [w for w in base_words if w in COMMON_ERROR_WORDS] if seed else []
        task_words = _dedup(seed_words + kept)

        for tr in entry.get("time_ranges", []):
            start = tr.get("start") or None
            end   = tr.get("end")   or None
            if not start or not end:
                default_start, default_end = _default_time_range()
                if not start:
                    print(
                        f"WARN: null start_time for {entry.get('log_url', '?')} — "
                        f"defaulting to now-2h ({default_start})",
                        file=sys.stderr,
                    )
                    start = default_start
                if not end:
                    print(
                        f"WARN: null end_time for {entry.get('log_url', '?')} — "
                        f"defaulting to now ({default_end})",
                        file=sys.stderr,
                    )
                    end = default_end
            tasks.append(ScanTask(
                log_url=entry["log_url"],
                start=start,
                end=end,
                words=task_words,
            ))

    return tasks


def build_tasks_from_args(
    log_urls: list[str],
    words: list[str],
    tokenized_query_tokens: list[str],
    original_query: str,
    seed: bool,
    query: str,
    time_ranges_json: str | None,
    start_time: str | None,
    end_time: str | None,
    source_dir: "str | None" = None,
) -> list[ScanTask]:
    """
    Build a flat list of ScanTask objects from flat CLI values.

    All log URLs share one keyword list and one set of time windows
    (cartesian product: N logs × M windows = N×M tasks).

    ``source_dir`` enables keyword validation: words not traceable to the
    user query or project source code literals are dropped before scanning.
    """
    log_words: list[str] = list(words)
    tokenized_query: list[str] = []

    if tokenized_query_tokens:
        if not original_query:
            print(
                "ERROR: --original-query is required when using --tokenized-query.",
                file=sys.stderr,
            )
            sys.exit(1)
        valid, rejected = validate_tokenized_query(tokenized_query_tokens, original_query)
        if rejected:
            print(
                f"WARN: tokens not found in original query, dropped: {rejected}",
                file=sys.stderr,
            )
        tokenized_query = valid
        for tok in valid:
            log_words.append(tok)  # use raw value — server does literal search

    if seed:
        log_words = COMMON_ERROR_WORDS + log_words

    if query:
        extra = tokenize_query(query)
        if not tokenized_query:
            tokenized_query = extra
        log_words = extra + log_words

    # Filter out hallucinated keywords: keep only words from query or code.
    # COMMON_ERROR_WORDS (added by --seed) are exempt from validation.
    effective_query = original_query or query
    if effective_query:
        non_seed = [w for w in log_words if w not in COMMON_ERROR_WORDS]
        kept, dropped = filter_keywords(non_seed, effective_query, source_dir)
        if dropped:
            print(
                f"WARN: keywords removed (not in query or code): {dropped}",
                file=sys.stderr,
            )
        seed_words = [w for w in log_words if w in COMMON_ERROR_WORDS]
        log_words = _dedup(seed_words + kept)
    else:
        log_words = _dedup(log_words)

    time_ranges: list[tuple[str, str]] = []
    if time_ranges_json:
        try:
            raw = json.loads(time_ranges_json)
            if not isinstance(raw, list) or not raw:
                raise ValueError("Expected a non-empty JSON array")
            time_ranges = [(r["start"], r["end"]) for r in raw]
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            print(
                f'ERROR: --time-ranges must be a JSON array of {{"start": "...", "end": "..."}} '
                f"objects: {exc}",
                file=sys.stderr,
            )
            sys.exit(1)
    else:
        time_ranges = [(start_time, end_time)]

    return [
        ScanTask(
            log_url=url,
            start=start,
            end=end,
            words=log_words,
        )
        for url in log_urls
        for start, end in time_ranges
    ]
