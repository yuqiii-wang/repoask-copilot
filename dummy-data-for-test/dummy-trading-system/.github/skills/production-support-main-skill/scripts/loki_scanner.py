#!/usr/bin/env python3
"""
loki_scanner.py — Search keywords in Loki logs and return timestamp hits.

Provides Loki-based scanning functions compatible with the main.py workflow.
Unlike the logtail server scanner which uses HTTP GET requests to individual
log files, this module queries Loki's query_range API with LogQL expressions.

Key differences from logtail scanning:
- Loki queries all logs matching a stream selector in one API call
- No individual log file URLs — uses stream selectors like {job="app-logs"}
- Time ranges are in ISO-8601 format (Loki native)
- Results are aggregated across all log streams

Usage:
    from loki_scanner import scan_loki_keywords, build_loki_tasks_from_plan
    
    tasks = build_loki_tasks_from_plan(plan, loki_url="http://localhost:8094")
    results = await scan_loki_all(tasks)
"""

import asyncio
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, NamedTuple, Tuple


class LokiScanTask(NamedTuple):
    """One (stream, window, keywords) triplet for Loki scanning."""
    stream_selector: str  # LogQL stream selector, e.g. {job="app-logs"}
    start_iso: str        # ISO-8601 start time
    end_iso: str          # ISO-8601 end time
    keywords: List[str]   # Keywords to search for
    loki_url: str         # Base Loki URL


def _parse_time(time_str: str) -> str:
    """
    Convert various time formats to ISO-8601 for Loki.
    
    Accepts:
    - ISO-8601: "2026-04-01T09:00:00Z"
    - Space-separated: "2026-04-01 09:00:00.000"
    - Compact: "202604010900"
    
    Returns ISO-8601 formatted string.
    """
    if not time_str:
        return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    
    # Already ISO-8601
    if 'T' in time_str and 'Z' in time_str:
        return time_str
    
    # Space-separated format "2026-04-01 09:00:00.000"
    if ' ' in time_str:
        dt = datetime.strptime(time_str.split('.')[0], "%Y-%m-%d %H:%M:%S")
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    
    # Compact format "202604010900"
    if len(time_str) == 12 and time_str.isdigit():
        dt = datetime.strptime(time_str, "%Y%m%d%H%M")
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    
    # Try to parse as-is
    try:
        dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        print(f"Warning: Could not parse time '{time_str}', using current time", file=sys.stderr)
        return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _query_loki(
    loki_url: str,
    query: str,
    start_iso: str,
    end_iso: str,
    limit: int = 5000
) -> Dict[str, Any]:
    """
    Execute LogQL query against Loki API.
    
    Args:
        loki_url: Base Loki URL (e.g., http://localhost:8094)
        query: LogQL query string
        start_iso: Start time ISO-8601
        end_iso: End time ISO-8601
        limit: Max number of log entries
        
    Returns:
        Loki API response JSON
    """
    url = f"{loki_url.rstrip('/')}/loki/api/v1/query_range"
    params = {
        "query": query,
        "start": start_iso,
        "end": end_iso,
        "limit": str(limit),
        "direction": "forward"
    }
    
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    
    # Debug: Log the query being executed
    print(f"DEBUG: Querying Loki: {full_url}", file=sys.stderr)
    
    req = urllib.request.Request(full_url)
    req.add_header("Content-Type", "application/json")
    
    # Add authentication if configured
    auth_token = os.environ.get("LOKI_AUTH_TOKEN")
    if auth_token:
        req.add_header("Authorization", f"Bearer {auth_token}")
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            result = json.loads(data)
            
            # Debug: Log response summary
            if result.get("status") == "success":
                num_streams = len(result.get("data", {}).get("result", []))
                print(f"DEBUG: Loki response: {num_streams} stream(s)", file=sys.stderr)
            else:
                print(f"DEBUG: Loki response status: {result.get('status')}", file=sys.stderr)
            
            return result
    except urllib.error.URLError as e:
        print(f"Error querying Loki: {e}", file=sys.stderr)
        return {"status": "error", "error": str(e)}
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return {"status": "error", "error": str(e)}


def _extract_timestamps_from_response(response: Dict[str, Any]) -> List[str]:
    """
    Extract timestamps from Loki query response.
    
    Returns list of ISO-8601 timestamp strings.
    """
    timestamps = []
    
    if response.get("status") != "success":
        print(f"DEBUG: Loki response not successful: {response.get('status')}", file=sys.stderr)
        return timestamps
    
    data = response.get("data", {})
    result = data.get("result", [])
    
    total_entries = 0
    for stream in result:
        values = stream.get("values", [])
        total_entries += len(values)
        for entry in values:
            # entry is [timestamp_nanoseconds, log_line]
            if len(entry) >= 1:
                ts_ns = int(entry[0])
                ts_sec = ts_ns / 1_000_000_000
                dt = datetime.utcfromtimestamp(ts_sec)
                # Format as ISO-8601 with milliseconds
                ts_str = dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                timestamps.append(ts_str)
    
    print(f"DEBUG: Extracted {len(timestamps)} unique timestamps from {total_entries} log entries", file=sys.stderr)
    return sorted(set(timestamps))


async def scan_loki_keyword(
    task: LokiScanTask,
    keyword: str
) -> Tuple[str, List[str]]:
    """
    Search for a single keyword in Loki logs.
    
    Returns (keyword, [timestamps]) tuple.
    """
    # Build case-insensitive regex LogQL query
    query = f'{task.stream_selector} |~ "(?i){re.escape(keyword)}"'
    
    try:
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            _query_loki,
            task.loki_url,
            query,
            task.start_iso,
            task.end_iso
        )
        
        timestamps = _extract_timestamps_from_response(response)
        return keyword, timestamps
    except Exception as e:
        print(f"Error searching keyword '{keyword}': {e}", file=sys.stderr)
        return keyword, []


async def scan_loki_task(task: LokiScanTask) -> Dict[str, List[str]]:
    """
    Search all keywords in a Loki scan task.
    
    Returns {keyword: [timestamps]} dict.
    """
    results = await asyncio.gather(
        *[scan_loki_keyword(task, kw) for kw in task.keywords]
    )
    return {kw: ts for kw, ts in results}


async def scan_loki_all(tasks: List[LokiScanTask]) -> Dict[str, Dict[str, List[str]]]:
    """
    Execute all Loki scan tasks in parallel.
    
    Returns dict keyed by "{stream_selector}[{start}~{end}]".
    """
    results = await asyncio.gather(
        *[scan_loki_task(task) for task in tasks]
    )
    
    return {
        f"{task.stream_selector}[{task.start_iso}~{task.end_iso}]": result
        for task, result in zip(tasks, results)
    }


def build_loki_tasks_from_plan(
    plan: Dict[str, Any],
    loki_url: str = "http://localhost:8094",
    default_stream: str = '{job="app-logs"}'
) -> List[LokiScanTask]:
    """
    Convert a production-support-plan JSON into Loki scan tasks.
    
    Unlike logtail scanning, Loki tasks use stream selectors instead of
    individual log file URLs. The plan's proposed_logs keys are mapped to
    stream selectors.
    
    Args:
        plan: Production support plan JSON
        loki_url: Loki server base URL
        default_stream: Default stream selector when logs aren't specified
        
    Returns:
        List of LokiScanTask objects
    """
    tasks = []
    
    # Get keywords from the plan
    proposed_keywords = plan.get("proposed_keywords", [])
    
    # Get log streams from proposed_logs
    proposed_logs = plan.get("proposed_logs", {})
    
    if not proposed_logs:
        # Fallback: use default stream with proposed keywords
        if proposed_keywords:
            # Use incident_time or default range
            incident_time = plan.get("incident_time")
            if incident_time:
                # Parse compact timestamp
                start_iso = _parse_time(incident_time)
                # Default 4-hour window
                end_dt = datetime.strptime(start_iso, "%Y-%m-%dT%H:%M:%SZ")
                from datetime import timedelta
                end_dt += timedelta(hours=4)
                end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                # Default: last 2 hours
                end_dt = datetime.utcnow()
                start_dt = end_dt - timedelta(hours=2)
                start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            
            tasks.append(LokiScanTask(
                stream_selector=default_stream,
                start_iso=start_iso,
                end_iso=end_iso,
                keywords=proposed_keywords,
                loki_url=loki_url
            ))
    else:
        # Create tasks for each log stream
        for log_prefix, categories in proposed_logs.items():
            # Map log prefix to Loki stream selector
            # In practice, this might be more sophisticated
            stream = f'{{job="app-logs",component="{log_prefix}"}}'
            
            if not categories:
                # No specific time ranges, use incident_time or full range
                incident_time = plan.get("incident_time")
                if incident_time:
                    start_iso = _parse_time(incident_time)
                    end_dt = datetime.strptime(start_iso, "%Y-%m-%dT%H:%M:%SZ")
                    from datetime import timedelta
                    end_dt += timedelta(hours=4)
                    end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                else:
                    end_dt = datetime.utcnow()
                    start_dt = end_dt - timedelta(hours=2)
                    start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                    end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                
                tasks.append(LokiScanTask(
                    stream_selector=stream,
                    start_iso=start_iso,
                    end_iso=end_iso,
                    keywords=proposed_keywords,
                    loki_url=loki_url
                ))
            else:
                # Create task for each time range category
                for category, time_range in categories.items():
                    start = time_range.get("start")
                    end = time_range.get("end")
                    
                    if start and end:
                        start_iso = _parse_time(start)
                        end_iso = _parse_time(end)
                    else:
                        # Use incident_time or default
                        incident_time = plan.get("incident_time")
                        if incident_time:
                            start_iso = _parse_time(incident_time)
                            end_dt = datetime.strptime(start_iso, "%Y-%m-%dT%H:%M:%SZ")
                            from datetime import timedelta
                            end_dt += timedelta(hours=4)
                            end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                        else:
                            end_dt = datetime.utcnow()
                            start_dt = end_dt - timedelta(hours=2)
                            start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                            end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                    
                    tasks.append(LokiScanTask(
                        stream_selector=stream,
                        start_iso=start_iso,
                        end_iso=end_iso,
                        keywords=proposed_keywords,
                        loki_url=loki_url
                    ))
    
    return tasks


def merge_loki_hits(results: Dict[str, Dict[str, List[str]]]) -> Dict[str, Dict[str, List[str]]]:
    """
    Merge Loki scan results by stream name.
    
    Groups hits by stream selector and keyword.
    """
    merged: Dict[str, Dict[str, List[str]]] = {}
    
    for task_key, hit_map in results.items():
        # Extract stream selector from task key
        stream = task_key.split('[')[0]
        
        if stream not in merged:
            merged[stream] = {}
        
        for keyword, timestamps in hit_map.items():
            if keyword not in merged[stream]:
                merged[stream][keyword] = []
            merged[stream][keyword].extend(timestamps)
    
    # Sort and deduplicate timestamps
    for stream in merged:
        for keyword in merged[stream]:
            merged[stream][keyword] = sorted(set(merged[stream][keyword]))
    
    return merged


async def scan_loki_unified(loki_queries, loki_url: str = "http://localhost:8094") -> Dict[str, Dict[str, List[str]]]:
    """
    Execute Loki queries from the unified query builder format.
    
    Args:
        loki_queries: List of LokiQuery NamedTuples from query_builders module
        loki_url: Base URL for Loki server
        
    Returns:
        Dict mapping stream_selector to {keyword: [timestamps]}
    """
    results: Dict[str, Dict[str, List[str]]] = {}
    
    async def execute_query(query):
        """Execute a single Loki query and return (stream, keyword_hits)."""
        try:
            loop = asyncio.get_event_loop()
            
            response = await loop.run_in_executor(
                None,
                _query_loki,
                loki_url,
                query.params['query'],
                query.params['start'],
                query.params['end'],
                int(query.params.get('limit', 5000))
            )
            
            timestamps = _extract_timestamps_from_response(response)
            
            # Extract keywords from the LogQL pattern
            import re
            # Pattern for multi-keyword: |~ "(?i)(kw1|kw2|kw3)"
            multi_match = re.search(r'\|\~ "(?:\(\?i\))?\(([^)]+)\)"', query.logql)
            if multi_match:
                # Multi-keyword query - return all keywords with same timestamps
                keywords_str = multi_match.group(1)
                # Unescape the keywords that were escaped in the regex
                keywords = [kw.replace('\\', '') for kw in keywords_str.split('|')]
                return query.stream_selector, {kw: timestamps for kw in keywords}
            else:
                # Single keyword: |~ "(?i)keyword"
                single_match = re.search(r'\|\~ "(?:\(\?i\))?([^"]+)"', query.logql)
                if single_match:
                    keyword = single_match.group(1).replace('\\', '')  # Unescape
                else:
                    keyword = "all"
                return query.stream_selector, {keyword: timestamps}
        except Exception as e:
            print(f"Error executing Loki query '{query.logql}': {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return query.stream_selector, {}
    
    # Execute all queries in parallel
    query_results = await asyncio.gather(*[execute_query(q) for q in loki_queries])
    
    # Merge results by stream selector
    for stream_selector, keyword_hits in query_results:
        if stream_selector not in results:
            results[stream_selector] = {}
        
        for keyword, timestamps in keyword_hits.items():
            if keyword not in results[stream_selector]:
                results[stream_selector][keyword] = []
            results[stream_selector][keyword].extend(timestamps)
    
    # Sort and deduplicate
    for stream in results:
        for keyword in results[stream]:
            results[stream][keyword] = sorted(set(results[stream][keyword]))
    
    # Debug: Log final results summary
    total_hits = sum(len(timestamps) for stream_kw in results.values() for timestamps in stream_kw.values())
    print(f"DEBUG: scan_loki_unified completed. {len(results)} stream(s), {total_hits} total timestamp hits", file=sys.stderr)
    
    return results


if __name__ == "__main__":
    # Simple CLI test
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python loki_scanner.py <plan.json> [loki-url]")
        sys.exit(1)
    
    plan_path = sys.argv[1]
    loki_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8094"
    
    with open(plan_path) as f:
        plan = json.load(f)
    
    tasks = build_loki_tasks_from_plan(plan, loki_url)
    print(f"Built {len(tasks)} Loki scan task(s)", file=sys.stderr)
    
    results = asyncio.run(scan_loki_all(tasks))
    merged = merge_loki_hits(results)
    print(json.dumps(merged, indent=2))
