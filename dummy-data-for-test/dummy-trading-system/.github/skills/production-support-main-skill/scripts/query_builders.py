#!/usr/bin/env python3
"""
query_builders.py — Unified query builders for Logtail and Loki log systems.

Converts the unified plan JSON structure into concrete API queries for:
1. Logtail: HTTP GET requests to file-based log server
2. Loki: LogQL queries to log aggregation system

Example unified plan structure:
{
  "_meta": {
    "round": 1,
    "max_rounds": 5,
    "budget_remaining": 4,
    "mode": "loki"  // or "logtail"
  },
  "{job=\"app-logs\",component=\"trading-system\"}": {
    "Strategy": [],
    "backtest": [],
    "FAILED": [],
    "202604010845": []  // Timestamp defines time window
  }
}
"""

import re
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple, NamedTuple


# ============================================================================
# Shared Time Utilities
# ============================================================================

def parse_timestamp(ts_str: str) -> datetime:
    """
    Parse timestamp in various formats to datetime object.
    
    Supported formats:
    - Compact: "202604010845" (YYYYMMDDHHmm)
    - ISO-8601: "2026-04-01T08:45:00Z"
    - Space-separated: "2026-04-01 08:45:00.000"
    
    Args:
        ts_str: Timestamp string
        
    Returns:
        datetime object (UTC)
    """
    if not ts_str:
        return datetime.utcnow()
    
    # Compact format: YYYYMMDDHHmm (12 digits)
    if len(ts_str) == 12 and ts_str.isdigit():
        return datetime.strptime(ts_str, "%Y%m%d%H%M")
    
    # ISO-8601: "2026-04-01T08:45:00Z"
    if 'T' in ts_str and 'Z' in ts_str:
        return datetime.strptime(ts_str.replace('Z', ''), "%Y-%m-%dT%H:%M:%S")
    
    # Space-separated: "2026-04-01 08:45:00.000"
    if ' ' in ts_str:
        base = ts_str.split('.')[0]  # Drop milliseconds
        return datetime.strptime(base, "%Y-%m-%d %H:%M:%S")
    
    # Try generic ISO format
    try:
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError(f"Unsupported timestamp format: {ts_str}")


def to_iso8601(dt: datetime) -> str:
    """Convert datetime to ISO-8601 string (UTC)."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_hhmm(dt: datetime) -> str:
    """Convert datetime to HH:MM string (for Logtail)."""
    return dt.strftime("%H:%M")


def to_logtail_timestamp(dt: datetime) -> str:
    """Convert datetime to logtail format (YYYY-MM-DD HH:MM:SS.mmm)."""
    return dt.strftime("%Y-%m-%d %H:%M:%S.000")


def extract_time_window(
    keywords: Dict[str, List[str]],
    default_hours: int = 4
) -> Tuple[Optional[datetime], Optional[datetime]]:
    """
    Extract time window from keyword dictionary.
    
    Scans for timestamp-like keys (12-digit numbers or ISO strings)
    and uses the earliest one as the start time. End time is start + default_hours.
    
    Args:
        keywords: Dictionary with keyword keys and empty list values
        default_hours: Duration of time window in hours
        
    Returns:
        (start_datetime, end_datetime) tuple, or (None, None) if no timestamp found
    """
    timestamps = []
    
    for key in keywords.keys():
        # Check if key looks like a timestamp
        if len(key) == 12 and key.isdigit():
            timestamps.append(parse_timestamp(key))
        elif 'T' in key or '-' in key:
            try:
                timestamps.append(parse_timestamp(key))
            except ValueError:
                continue  # Not a valid timestamp
    
    if timestamps:
        start = min(timestamps)  # Use earliest timestamp
        end = start + timedelta(hours=default_hours)
        return start, end
    
    return None, None


def extract_keywords(keywords_dict: Dict[str, List[str]]) -> List[str]:
    """
    Extract actual keywords (non-timestamp keys) from keyword dictionary.
    
    Args:
        keywords_dict: Dictionary with keyword keys
        
    Returns:
        List of keyword strings
    """
    keywords = []
    
    for key in keywords_dict.keys():
        # Skip timestamp-like keys
        if len(key) == 12 and key.isdigit():
            continue
        if key.startswith('20') and ('T' in key or len(key) >= 10):
            continue
        
        keywords.append(key)
    
    return keywords


# ============================================================================
# Logtail Query Builder
# ============================================================================

class LogtailQuery(NamedTuple):
    """Logtail HTTP GET query."""
    component: str
    url: str
    description: str


def extract_component_from_selector(selector: str) -> str:
    """
    Extract component name from Loki-style selector.
    
    Examples:
    - '{job="app-logs",component="trading-system"}' -> 'trading-system'
    - '{component="error-scenarios"}' -> 'error-scenarios'
    - 'trading-system' -> 'trading-system' (plain name)
    
    Args:
        selector: Stream selector string
        
    Returns:
        Component name
    """
    # Match component="name" pattern
    match = re.search(r'component="([^"]+)"', selector)
    if match:
        return match.group(1)
    
    # Fallback: strip curly braces and use as-is
    return selector.strip('{}').strip()


def build_logtail_queries(
    plan: Dict[str, Any],
    base_url: str = "http://localhost:8093",
    default_hours: int = 4
) -> List[LogtailQuery]:
    """
    Build Logtail HTTP GET queries from unified plan.
    
    Args:
        plan: Unified plan JSON
        base_url: Logtail server base URL
        default_hours: Default time window in hours
        
    Returns:
        List of LogtailQuery objects
        
    Example:
        plan = {
          "_meta": {"mode": "logtail"},
          "{job=\"app-logs\",component=\"trading-system\"}": {
            "Strategy": [], "FAILED": [], "202604010845": []
          }
        }
        
        queries = build_logtail_queries(plan)
        # Returns queries like:
        # /logTail/trading-system?file=trading-system-202604010845.log&i=Strategy&f=08:45&t=12:45
    """
    queries = []
    base_url = base_url.rstrip('/')
    
    for stream_key, keywords_dict in plan.items():
        # Skip metadata
        if stream_key.startswith('_'):
            continue
        
        # Extract component name
        component = extract_component_from_selector(stream_key)
        
        # Extract time window
        start_dt, end_dt = extract_time_window(keywords_dict, default_hours)
        
        if not start_dt:
            # No timestamp found, skip this entry or use default
            continue
        
        # Extract keywords
        keywords = extract_keywords(keywords_dict)
        
        if not keywords:
            # No keywords, retrieve full log file
            keywords = [None]  # Will build query without ?i= param
        
        # Build filename from timestamp
        # Format: component-YYYYMMDDHHmm.log
        timestamp_str = start_dt.strftime("%Y%m%d%H%M")
        filename = f"{component}-{timestamp_str}.log"
        
        # Build time range params
        from_time = to_hhmm(start_dt)
        to_time = to_hhmm(end_dt)
        
        # Create query for each keyword
        for keyword in keywords:
            params = {
                'file': filename,
                'f': from_time,
                't': to_time
            }
            
            if keyword:
                params['i'] = keyword
            
            query_string = urllib.parse.urlencode(params)
            url = f"{base_url}/logTail/{component}?{query_string}"
            
            description = f"Search '{keyword}' in {component} from {from_time} to {to_time}" if keyword else f"Retrieve {component} logs from {from_time} to {to_time}"
            
            queries.append(LogtailQuery(
                component=component,
                url=url,
                description=description
            ))
    
    return queries


# ============================================================================
# Loki Query Builder
# ============================================================================

class LokiQuery(NamedTuple):
    """Loki LogQL query."""
    stream_selector: str
    logql: str
    start_time: str  # ISO-8601
    end_time: str    # ISO-8601
    params: Dict[str, str]
    description: str


def build_loki_queries(
    plan: Dict[str, Any],
    base_url: str = "http://localhost:8094",
    default_hours: int = 4,
    limit: int = 5000
) -> List[LokiQuery]:
    """
    Build Loki LogQL queries from unified plan.
    
    Args:
        plan: Unified plan JSON
        base_url: Loki server base URL (not used in query, returned for reference)
        default_hours: Default time window in hours
        limit: Max log entries per query
        
    Returns:
        List of LokiQuery objects
        
    Example:
        plan = {
          "_meta": {"mode": "loki"},
          "{job=\"app-logs\",component=\"trading-system\"}": {
            "Strategy": [], "FAILED": [], "202604010845": []
          }
        }
        
        queries = build_loki_queries(plan)
        # Returns queries with LogQL like:
        # {job="app-logs",component="trading-system"} |~ "(?i)strategy"
        # Time range: 2026-04-01T08:45:00Z to 2026-04-01T12:45:00Z
    """
    queries = []
    
    for stream_key, keywords_dict in plan.items():
        # Skip metadata
        if stream_key.startswith('_'):
            continue
        
        # Use stream_key as-is for Loki selector
        stream_selector = stream_key
        
        # Extract time window
        start_dt, end_dt = extract_time_window(keywords_dict, default_hours)
        
        if not start_dt:
            # No timestamp, use current time minus default_hours
            end_dt = datetime.utcnow()
            start_dt = end_dt - timedelta(hours=default_hours)
        
        start_iso = to_iso8601(start_dt)
        end_iso = to_iso8601(end_dt)
        
        # Extract keywords
        keywords = extract_keywords(keywords_dict)
        
        if not keywords:
            # No keywords, retrieve all logs for stream
            logql = stream_selector
            
            params = {
                'query': logql,
                'start': start_iso,
                'end': end_iso,
                'limit': str(limit),
                'direction': 'forward'
            }
            
            queries.append(LokiQuery(
                stream_selector=stream_selector,
                logql=logql,
                start_time=start_iso,
                end_time=end_iso,
                params=params,
                description=f"Retrieve all logs for {stream_selector} from {start_iso} to {end_iso}"
            ))
        else:
            # Create query for each keyword (case-insensitive regex)
            for keyword in keywords:
                # Build case-insensitive regex filter
                # Use |~ for regex match, (?i) for case-insensitive
                escaped_keyword = re.escape(keyword)
                logql = f'{stream_selector} |~ "(?i){escaped_keyword}"'
                
                params = {
                    'query': logql,
                    'start': start_iso,
                    'end': end_iso,
                    'limit': str(limit),
                    'direction': 'forward'
                }
                
                queries.append(LokiQuery(
                    stream_selector=stream_selector,
                    logql=logql,
                    start_time=start_iso,
                    end_time=end_iso,
                    params=params,
                    description=f"Search '{keyword}' in {stream_selector} from {start_iso} to {end_iso}"
                ))
    
    return queries


def build_loki_multi_keyword_query(
    stream_selector: str,
    keywords: List[str],
    start_dt: datetime,
    end_dt: datetime,
    limit: int = 5000
) -> LokiQuery:
    """
    Build a single Loki query that searches for multiple keywords using OR logic.
    
    More efficient than separate queries when you want any of the keywords.
    
    Args:
        stream_selector: Loki stream selector
        keywords: List of keywords to search for
        start_dt: Start datetime
        end_dt: End datetime
        limit: Max log entries
        
    Returns:
        LokiQuery with regex OR pattern
        
    Example:
        query = build_loki_multi_keyword_query(
            '{job="app-logs",component="trading-system"}',
            ['Strategy', 'backtest', 'FAILED'],
            datetime(2026, 4, 1, 8, 45),
            datetime(2026, 4, 1, 12, 45)
        )
        # LogQL: {job="app-logs",component="trading-system"} |~ "(?i)(strategy|backtest|failed)"
    """
    # Escape each keyword and join with |
    escaped_keywords = [re.escape(kw) for kw in keywords]
    pattern = '|'.join(escaped_keywords)
    
    # Build case-insensitive regex with OR
    logql = f'{stream_selector} |~ "(?i)({pattern})"'
    
    start_iso = to_iso8601(start_dt)
    end_iso = to_iso8601(end_dt)
    
    params = {
        'query': logql,
        'start': start_iso,
        'end': end_iso,
        'limit': str(limit),
        'direction': 'forward'
    }
    
    return LokiQuery(
        stream_selector=stream_selector,
        logql=logql,
        start_time=start_iso,
        end_time=end_iso,
        params=params,
        description=f"Search keywords {keywords} in {stream_selector} from {start_iso} to {end_iso}"
    )


def optimize_loki_queries(queries: List[LokiQuery]) -> List[LokiQuery]:
    """
    Optimize Loki queries by merging multiple keyword queries into single multi-keyword queries.
    
    Groups queries with the same stream selector and time range, then combines their keywords.
    
    Args:
        queries: List of individual LokiQuery objects
        
    Returns:
        Optimized list with merged queries
    """
    # Group by (stream_selector, start_time, end_time)
    groups: Dict[Tuple[str, str, str], List[LokiQuery]] = {}
    
    for query in queries:
        key = (query.stream_selector, query.start_time, query.end_time)
        if key not in groups:
            groups[key] = []
        groups[key].append(query)
    
    optimized = []
    
    for (stream_selector, start_time, end_time), group_queries in groups.items():
        if len(group_queries) == 1:
            # Single query, no optimization needed
            optimized.append(group_queries[0])
        else:
            # Extract keywords from each query
            keywords = []
            for q in group_queries:
                # Extract keyword from LogQL pattern: |~ "(?i)keyword"
                match = re.search(r'\|\~ "(?:\(\?i\))?([^"]+)"', q.logql)
                if match:
                    keyword = match.group(1)
                    # Unescape regex if needed
                    keywords.append(keyword)
            
            if keywords:
                # Build multi-keyword query
                start_dt = parse_timestamp(start_time)
                end_dt = parse_timestamp(end_time)
                limit = int(group_queries[0].params.get('limit', 5000))
                
                optimized.append(build_loki_multi_keyword_query(
                    stream_selector,
                    keywords,
                    start_dt,
                    end_dt,
                    limit
                ))
    
    return optimized
