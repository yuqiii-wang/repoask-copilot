#!/usr/bin/env python3
"""
keyword_filter.py — Strict keyword validator for production support plan creation.

Enforces that every proposed keyword in a scan plan comes from exactly one of
two allowed sources:
  1. The user's original query (verbatim tokens).
  2. Literal string fragments found in the project source code
     (logger.error / log.warn calls, Exception message literals, and
      @RequestMapping / @GetMapping / @PostMapping route paths).

Any word that cannot be traced to either source is classified as a
hallucinated keyword and removed before the plan is finalized.

Public API
----------
  extract_code_keywords(source_dir) -> set[str]
  filter_keywords(words, query, source_dir=None) -> (kept, dropped)

Standalone usage
----------------
  python scripts/keyword_filter.py \\
      --words "error" "timeout" "settlement" "unicorn" \\
      --query "settlement order timed out" \\
      --source-dir /path/to/project/src
"""

import argparse
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Source code extraction patterns
# ---------------------------------------------------------------------------

_SOURCE_EXTENSIONS: frozenset[str] = frozenset(
    {".java", ".kt", ".groovy", ".js", ".ts", ".py", ".scala"}
)

_PLACEHOLDER_RE = re.compile(r"\{[^}]*\}|%[sd]|%\w+|\$\{[^}]+\}")

_LOG_CALL_RE = re.compile(
    r'(?:log(?:ger)?|LOG(?:GER)?)\s*[.(]\s*'
    r'(?:error|warn(?:ing)?|info|debug|fatal)\s*\(\s*["\']([^"\'\\n{}%]{3,})',
    re.IGNORECASE,
)
_EXCEPTION_RE = re.compile(
    r'throw\s+new\s+\w*[Ee]xception\s*\(\s*["\']([^"\'\\n{}%]{3,})',
    re.IGNORECASE,
)
_MAPPING_RE = re.compile(
    r'@(?:Request|Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["\']([^"\']+)',
    re.IGNORECASE,
)

_ALL_SOURCE_PATTERNS = (_LOG_CALL_RE, _EXCEPTION_RE, _MAPPING_RE)

# Stop words — no log-search signal
_STOP_WORDS: frozenset[str] = frozenset([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could",
    "i", "we", "you", "he", "she", "it", "they", "them", "their",
    "and", "or", "not", "but", "if", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "through",
    "during", "before", "after", "above", "below", "between",
    "what", "which", "who", "when", "where", "why", "how",
])


def _tokenize_query(query: str) -> list[str]:
    tokens: list[str] = []
    for match in re.finditer(r"/[a-zA-Z0-9_/-]+", query):
        tokens.append(match.group().lower())
    for w in re.findall(r"[a-zA-Z][a-zA-Z0-9_.-]*", query.lower()):
        if w not in _STOP_WORDS and len(w) >= 3:
            tokens.append(w)
    seen: set[str] = set()
    result: list[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            result.append(t)
    return result


def extract_code_keywords(source_dir: "str | Path") -> set[str]:
    """
    Recursively scan *source_dir* for log-call literals, exception messages,
    and route-mapping annotations.  Return lowercase word/path tokens.
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
        for seg in re.finditer(r"/[a-zA-Z0-9_/-]+", frag):
            tokens.add(seg.group().lower())
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9_.-]{2,}", frag):
            tokens.add(word.lower())
    return tokens


def filter_keywords(
    words: list[str],
    query: str,
    source_dir: "str | Path | None" = None,
) -> "tuple[list[str], list[str]]":
    """
    Validate *words* against the two allowed sources and return (kept, dropped).

    A word passes when at least one of its lowercase tokens appears in:
      - tokens from *query*, or
      - tokens from source code literals in *source_dir* (if given).
    """
    query_tokens: set[str] = set(_tokenize_query(query))
    code_tokens: set[str] = extract_code_keywords(source_dir) if source_dir else set()
    allowed: set[str] = query_tokens | code_tokens

    kept: list[str] = []
    dropped: list[str] = []

    for w in words:
        w_low = w.lower()
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
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Validate proposed keywords against query and source code."
    )
    p.add_argument("--words", nargs="+", required=True, metavar="KW")
    p.add_argument("--query", default="", metavar="TEXT")
    p.add_argument("--source-dir", default=None, metavar="DIR")
    return p


def main() -> None:
    args = _build_parser().parse_args()
    kept, dropped = filter_keywords(
        words=args.words,
        query=args.query,
        source_dir=args.source_dir,
    )
    if dropped:
        print(f"DROPPED (not in query or code): {dropped}", file=sys.stderr)
    print(json.dumps(kept, indent=2))


if __name__ == "__main__":
    main()
