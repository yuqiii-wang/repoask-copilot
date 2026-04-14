#!/usr/bin/env python3
"""
loki_client.py — Query Loki API for keyword hit sequences.

Provides utilities to query Loki's HTTP API using LogQL expressions,
fetch log streams with time ranges, and search for keyword occurrences
returning only timestamps (no sensitive log content).

Example usage:
    from loki_client import LokiClient, discover_log_streams
    
    # Discover available log streams
    streams = discover_log_streams("http://localhost:8094")
    
    # Query for keywords in a specific time window
    client = LokiClient("http://localhost:8094")
    hits = client.search_keywords(
        stream_selector='{job="app-logs"}',
        keywords=["error", "timeout"],
        start_time="2026-04-01T09:00:00Z",
        end_time="2026-04-01T13:00:00Z"
    )
"""

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


class LokiClient:
    """Client for querying Grafana Loki log aggregation system."""

    def __init__(self, base_url: str = "http://localhost:8094"):
        """
        Initialize Loki client.
        
        Args:
            base_url: Loki server base URL (default: http://localhost:8094)
        """
        self.base_url = base_url.rstrip("/")
        self.query_range_url = f"{self.base_url}/loki/api/v1/query_range"
        self.labels_url = f"{self.base_url}/loki/api/v1/labels"
        self.label_values_url = f"{self.base_url}/loki/api/v1/label"

    def _make_request(self, url: str, params: Dict[str, str]) -> Dict[str, Any]:
        """
        Make HTTP GET request to Loki API.
        
        Args:
            url: Full URL to query
            params: Query parameters
            
        Returns:
            Parsed JSON response
            
        Raises:
            urllib.error.URLError: If request fails
        """
        query_string = urllib.parse.urlencode(params)
        full_url = f"{url}?{query_string}"
        
        req = urllib.request.Request(full_url)
        req.add_header("Content-Type", "application/json")
        
        # Add authentication if configured
        auth_token = os.environ.get("LOKI_AUTH_TOKEN")
        if auth_token:
            req.add_header("Authorization", f"Bearer {auth_token}")
        
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            return json.loads(data)

    def query_range(
        self,
        query: str,
        start_time: str,
        end_time: str,
        limit: int = 5000
    ) -> Dict[str, Any]:
        """
        Execute LogQL query over a time range.
        
        Args:
            query: LogQL query expression (e.g., '{job="app-logs"} |= "ERROR"')
            start_time: Start time in ISO-8601 format or Unix timestamp (nanoseconds)
            end_time: End time in ISO-8601 format or Unix timestamp (nanoseconds)
            limit: Maximum number of entries to return (default: 5000)
            
        Returns:
            Loki API response with matched log streams
        """
        params = {
            "query": query,
            "start": start_time,
            "end": end_time,
            "limit": str(limit),
            "direction": "forward"
        }
        
        return self._make_request(self.query_range_url, params)

    def search_keywords(
        self,
        stream_selector: str,
        keywords: List[str],
        start_time: str,
        end_time: str,
        limit: int = 5000
    ) -> Dict[str, List[str]]:
        """
        Search for keyword occurrences and return timestamps only.
        
        Args:
            stream_selector: LogQL stream selector (e.g., '{job="app-logs"}')
            keywords: List of keywords to search for
            start_time: Start time in ISO-8601 format
            end_time: End time in ISO-8601 format
            limit: Maximum entries per query
            
        Returns:
            Dict mapping each keyword to list of ISO-8601 timestamps where it appears
            
        Example:
            {
                "error": ["2026-04-01T09:15:23.456Z", "2026-04-01T09:20:15.789Z"],
                "timeout": ["2026-04-01T09:15:25.123Z"]
            }
        """
        result: Dict[str, List[str]] = {}
        
        for keyword in keywords:
            # Build case-insensitive regex LogQL query
            # Using |~ for regex match instead of |= for exact match
            query = f'{stream_selector} |~ "(?i){re.escape(keyword)}"'
            
            try:
                response = self.query_range(query, start_time, end_time, limit)
                timestamps = self._extract_timestamps(response)
                if timestamps:
                    result[keyword] = timestamps
            except Exception as e:
                # Log error but continue with other keywords
                print(f"Warning: Failed to query keyword '{keyword}': {e}", file=__import__('sys').stderr)
                continue
        
        return result

    def _extract_timestamps(self, response: Dict[str, Any]) -> List[str]:
        """
        Extract timestamps from Loki query_range response.
        
        Args:
            response: Loki API response dict
            
        Returns:
            List of ISO-8601 timestamp strings
        """
        timestamps = []
        
        if response.get("status") != "success":
            return timestamps
        
        data = response.get("data", {})
        result = data.get("result", [])
        
        for stream in result:
            values = stream.get("values", [])
            for entry in values:
                # entry is [timestamp_nanoseconds, log_line]
                if len(entry) >= 1:
                    # Convert nanosecond timestamp to ISO-8601
                    ts_ns = int(entry[0])
                    ts_sec = ts_ns / 1_000_000_000
                    dt = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
                    timestamps.append(dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z")
        
        return sorted(set(timestamps))  # Remove duplicates and sort

    def get_labels(self) -> List[str]:
        """
        Get all available label names from Loki.
        
        Returns:
            List of label names
        """
        try:
            response = self._make_request(self.labels_url, {})
            if response.get("status") == "success":
                return response.get("data", [])
        except Exception:
            pass
        return []

    def get_label_values(self, label_name: str) -> List[str]:
        """
        Get all values for a specific label.
        
        Args:
            label_name: Name of the label (e.g., "job", "level")
            
        Returns:
            List of values for that label
        """
        try:
            url = f"{self.label_values_url}/{label_name}/values"
            response = self._make_request(url, {})
            if response.get("status") == "success":
                return response.get("data", [])
        except Exception:
            pass
        return []


def discover_log_streams(base_url: str = "http://localhost:8094") -> List[Dict[str, Any]]:
    """
    Discover available log streams from Loki.
    
    Args:
        base_url: Loki server base URL
        
    Returns:
        List of stream descriptors with component names and stream selectors
        
    Example:
        [
            {
                "job": "app-logs",
                "component": "trading-system",
                "selector": '{job="app-logs",component="trading-system"}',
                "labels": ["component", "filename", "job"],
                "summary": "Log stream: trading-system"
            }
        ]
    """
    client = LokiClient(base_url)
    
    try:
        # Enumerate by component label (set during log ingestion)
        components = client.get_label_values("component")
        
        streams = []
        for component in components:
            stream = {
                "job": "app-logs",
                "component": component,
                "selector": f'{{job="app-logs",component="{component}"}}',
                "labels": client.get_labels(),
                "summary": f"Log stream: {component}"
            }
            streams.append(stream)
        
        return streams
    except Exception as e:
        print(f"Warning: Failed to discover log streams: {e}", file=__import__('sys').stderr)
        return []


def build_logql_query(
    base_selector: str,
    keywords: Optional[List[str]] = None,
    filters: Optional[Dict[str, str]] = None
) -> str:
    """
    Build a LogQL query from components.
    
    Args:
        base_selector: Base stream selector (e.g., '{job="app-logs"}')
        keywords: Optional list of keywords to search for (OR'd together)
        filters: Optional label filters (e.g., {"level": "ERROR"})
        
    Returns:
        Complete LogQL query string
        
    Example:
        build_logql_query(
            '{job="app-logs"}',
            keywords=["error", "timeout"],
            filters={"level": "ERROR"}
        )
        # Returns: '{job="app-logs",level="ERROR"} |~ "(?i)(error|timeout)"'
    """
    # Add label filters to selector
    if filters:
        # Remove trailing }
        selector = base_selector.rstrip("}")
        for key, value in filters.items():
            selector += f',{key}="{value}"'
        selector += "}"
    else:
        selector = base_selector
    
    # Add keyword filters
    if keywords:
        # Create case-insensitive regex for all keywords (OR'd)
        escaped_keywords = [re.escape(kw) for kw in keywords]
        keyword_pattern = "|".join(escaped_keywords)
        selector += f' |~ "(?i)({keyword_pattern})"'
    
    return selector


if __name__ == "__main__":
    # CLI test/demo
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python loki_client.py <command> [args...]")
        print("Commands:")
        print("  discover               - List available log streams")
        print("  search <keyword>...    - Search for keywords in last 24h")
        print("  query <logql>          - Execute raw LogQL query")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "discover":
        streams = discover_log_streams()
        print(json.dumps(streams, indent=2))
    
    elif cmd == "search":
        if len(sys.argv) < 3:
            print("Error: Provide at least one keyword to search")
            sys.exit(1)
        
        keywords = sys.argv[2:]
        client = LokiClient()
        
        # Search last 24 hours
        end = datetime.now(timezone.utc)
        start = datetime.fromtimestamp(end.timestamp() - 86400, tz=timezone.utc)
        
        hits = client.search_keywords(
            '{job="app-logs"}',
            keywords,
            start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            end.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        print(json.dumps(hits, indent=2))
    
    elif cmd == "query":
        if len(sys.argv) < 3:
            print("Error: Provide LogQL query")
            sys.exit(1)
        
        query = sys.argv[2]
        client = LokiClient()
        
        # Query last 24 hours
        end = datetime.now(timezone.utc)
        start = datetime.fromtimestamp(end.timestamp() - 86400, tz=timezone.utc)
        
        result = client.query_range(
            query,
            start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            end.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        print(json.dumps(result, indent=2))
    
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
