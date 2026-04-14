"""Log line parsing and hit summarization for query_logs.

Supports the Java log format produced by the trading-system:

    2026-04-11 14:13:17.645 ERROR [http-nio-8080-exec-3] com.security.trading.service.OmsService - ...

Privacy: only timestamp, level, and class name are extracted — raw message
content is deliberately discarded to respect data-access restrictions.
"""

import re
from datetime import datetime
from typing import Dict, List, Optional

# Group 1: date+time (seconds precision)
# Group 2: log level
# Group 3: fully-qualified logger / class name
_LOG_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})'  # timestamp (seconds)
    r'[.\d]*'                                      # optional .milliseconds
    r'\s+(\w+)'                                    # level  (ERROR, WARN, INFO …)
    r'\s+\[[^\]]+\]'                               # [thread-name]  (ignored)
    r'\s+([\w$.]+)',                               # logger / class name
)


def parse_log_line(line: str) -> Optional[Dict[str, str]]:
    """Return ``{ts_iso, level, class_name}`` or ``None`` if the line is not a log entry."""
    m = _LOG_RE.match(line.rstrip())
    if not m:
        return None
    ts_str, level, logger = m.groups()
    try:
        dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    ts_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    # Use only the simple class name — drop the package prefix.
    class_name = logger.rsplit(".", 1)[-1]
    return {"ts_iso": ts_iso, "level": level.upper(), "class_name": class_name}


def summarize_hits(parsed: List[Dict[str, str]]) -> List[str]:
    """Format a list of parsed hit dicts into event strings with consecutive-duplicate folding.

    Consecutive entries that share the same ``(level, class_name)`` are collapsed
    into a single string: ``"<first-ts> [LEVEL][ClassName] (xN times)"``.
    Isolated entries are formatted as ``"<ts> [LEVEL][ClassName]"``.
    """
    if not parsed:
        return []
    result: List[str] = []
    i = 0
    while i < len(parsed):
        cur = parsed[i]
        key = (cur["level"], cur["class_name"])
        j = i + 1
        while j < len(parsed) and (parsed[j]["level"], parsed[j]["class_name"]) == key:
            j += 1
        count = j - i
        entry = f"{cur['ts_iso']} [{cur['level']}][{cur['class_name']}]"
        if count >= 2:
            entry += f" (x{count} times)"
        result.append(entry)
        i = j
    return result
