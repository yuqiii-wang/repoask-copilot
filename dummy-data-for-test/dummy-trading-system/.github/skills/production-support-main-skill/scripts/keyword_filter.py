#!/usr/bin/env python3
"""
keyword_filter.py — Strict keyword validator for production log scanning.

Enforces that every proposed keyword comes from exactly one of two allowed
sources:
  1. The user's original query (verbatim tokens extracted by tokenize_query).
  2. Literal string fragments found in the project source code
     (logger.error / log.warn calls, Exception message literals, and
      @RequestMapping / @GetMapping / @PostMapping route paths).

Any word that cannot be traced to either source is classified as a
hallucinated keyword and removed before the scan plan is executed.

Public API
----------
  extract_code_keywords(source_dir) -> set[str]
      Walk a project source tree and return all keyword tokens found in log
      call literals, exception messages, and route annotations.

  filter_keywords(words, query, source_dir=None) -> (kept, dropped)
      Return (kept_list, dropped_list).  A word is kept only when at least
      one of its tokens is present in the allowed set (query tokens ∪ code
      tokens).

Standalone usage
----------------
  python scripts/keyword_filter.py \\
      --words "error" "timeout" "settlement" "unicorn" \\
      --query "settlement order timed out" \\
      --source-dir /path/to/project/src

  Output (stderr shows drops, stdout shows kept JSON list):
      DROPPED (not in query or code): ['unicorn']
      ["error", "timeout", "settlement"]
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from rules import tokenize_query as _tokenize_query  # available in main scripts dir
except ImportError:
    _tokenize_query = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Source code extraction patterns
# ---------------------------------------------------------------------------

_SOURCE_EXTENSIONS: frozenset[str] = frozenset(
    {".java", ".kt", ".groovy", ".js", ".ts", ".py", ".scala"}
)

_PLACEHOLDER_RE = re.compile(r"\{[^}]*\}|%[sd]|%\w+|\$\{[^}]+\}")

# logger.error("msg") / log.warn("msg") / LOG.info("msg") — Java, Python, JS/TS
_LOG_CALL_RE = re.compile(
    r'(?:log(?:ger)?|LOG(?:GER)?)\s*[.(]\s*'
    r'(?:error|warn(?:ing)?|info|debug|fatal)\s*\(\s*["\']([^"\'\\n{}%]{3,})',
    re.IGNORECASE,
)

# throw new SomeException("message")
_EXCEPTION_RE = re.compile(
    r'throw\s+new\s+\w*[Ee]xception\s*\(\s*["\']([^"\'\\n{}%]{3,})',
    re.IGNORECASE,
)

# @RequestMapping("/path") / @GetMapping("/path") etc.
_MAPPING_RE = re.compile(
    r'@(?:Request|Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["\']([^"\']+)',
    re.IGNORECASE,
)

_ALL_SOURCE_PATTERNS = (_LOG_CALL_RE, _EXCEPTION_RE, _MAPPING_RE)


def extract_code_keywords(source_dir: "str | Path") -> set[str]:
    """
    Recursively scan *source_dir* for log-call literals, exception messages,
    and route-mapping annotations.  Return a set of lowercase word/path tokens
    found in those string fragments.

    Placeholders ({}, %s, ${var}) are stripped before tokenisation.
    Returns an empty set if *source_dir* does not exist or is not a directory.
    """
    root = Path(source_dir)
    if not root.is_dir():
        return set()

    raw_fragments: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in _SOURCE_EXTENSIONS:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat in _ALL_SOURCE_PATTERNS:
            for m in pat.finditer(text):
                fragment = _PLACEHOLDER_RE.sub("", m.group(1)).strip()
                if fragment:
                    raw_fragments.append(fragment)

    tokens: set[str] = set()
    for frag in raw_fragments:
        # preserve URL path segments (e.g. /orders/filled)
        for seg in re.finditer(r"/[a-zA-Z0-9_/-]+", frag):
            tokens.add(seg.group().lower())
        # individual words >= 3 characters
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9_.-]{2,}", frag):
            tokens.add(word.lower())
    return tokens


# ---------------------------------------------------------------------------
# Public filter function
# ---------------------------------------------------------------------------

def filter_keywords(
    words: list[str],
    query: str,
    source_dir: "str | Path | None" = None,
) -> "tuple[list[str], list[str]]":
    """
    Validate *words* against the two allowed sources and return:
      (kept: list[str], dropped: list[str])

    A word passes when at least one of its lowercase tokens appears in:
      - tokens extracted from *query* via tokenize_query(), or
      - tokens extracted from source code literals in *source_dir* (if given).

    Words that pass no evidence check are dropped.
    """
    # --- build allowed set from query ---
    if _tokenize_query is not None:
        query_tokens: set[str] = set(t.lower() for t in _tokenize_query(query))
    else:
        query_tokens = set(re.findall(r"[a-zA-Z0-9_/.-]{3,}", query.lower()))

    # also keep raw path segments from query verbatim
    for seg in re.finditer(r"/[a-zA-Z0-9_/-]+", query):
        query_tokens.add(seg.group().lower())

    # --- build allowed set from source code ---
    code_tokens: set[str] = extract_code_keywords(source_dir) if source_dir else set()

    allowed: set[str] = query_tokens | code_tokens

    kept: list[str] = []
    dropped: list[str] = []

    for w in words:
        w_low = w.lower()
        # decompose word into sub-tokens (handles e.g. "/orders/", "sql error")
        sub_tokens: set[str] = {w_low}
        for seg in re.finditer(r"/[a-zA-Z0-9_/-]+", w_low):
            sub_tokens.add(seg.group())
        for tok in re.findall(r"[a-zA-Z][a-zA-Z0-9_.-]{2,}", w_low):
            sub_tokens.add(tok)

        if sub_tokens & allowed:
            kept.append(w)
        else:
            dropped.append(w)

    return kept, dropped


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Validate proposed keywords against query and source code."
    )
    p.add_argument(
        "--words", nargs="+", required=True, metavar="KW",
        help="Proposed keyword list to validate.",
    )
    p.add_argument(
        "--query", default="", metavar="TEXT",
        help="Original user query (allowed keyword source #1).",
    )
    p.add_argument(
        "--source-dir", default=None, metavar="DIR",
        help="Project source directory to scan for log/exception/route literals (allowed source #2).",
    )
    return p


def main() -> None:
    args = _build_parser().parse_args()
    kept, dropped = filter_keywords(
        words=args.words,
        query=args.query,
        source_dir=args.source_dir,
    )
    if dropped:
        print(
            f"DROPPED (not in query or code): {dropped}",
            file=sys.stderr,
        )
    print(json.dumps(kept, indent=2))


if __name__ == "__main__":
    main()
