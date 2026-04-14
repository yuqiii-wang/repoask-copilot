#!/usr/bin/env python3
"""
Simple script to ingest log files into Loki via HTTP API.
This bypasses Promtail for static log files.
"""

import glob
import json
import os
import re
import sys
import time
from datetime import datetime
import requests

LOKI_URL = "http://localhost:8094/loki/api/v1/push"

# Resolve log directory relative to this script's location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(SCRIPT_DIR, "..", "dummy-trading-system", "logs")

# Filename pattern: {component}-{yyyyMMddHHmmssSSS}.log
_FILENAME_RE = re.compile(r'^(.+)-\d{17}\.log$')


def discover_log_files(log_dir):
    """Yield (filepath, component) pairs by scanning log_dir."""
    for filepath in sorted(glob.glob(os.path.join(log_dir, "*.log"))):
        name = os.path.basename(filepath)
        m = _FILENAME_RE.match(name)
        if m:
            yield filepath, m.group(1)

def parse_log_line(line):
    """Extract timestamp from log line."""
    # Format: 2026-04-01 09:15:22.001 INFO  [...]
    match = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+', line)
    if match:
        timestamp_str = match.group(1)
        dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S.%f')
        # Convert to nanoseconds since epoch
        timestamp_ns = str(int(dt.timestamp() * 1_000_000_000))
        return timestamp_ns
    # Fallback to current time if can't parse
    return str(int(time.time() * 1_000_000_000))

def ingest_file(filepath, component):
    """Ingest a single log file into Loki."""
    print(f"Ingesting {os.path.basename(filepath)} as component={component}...", file=sys.stderr)
    
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"  ✗ Error reading file: {e}", file=sys.stderr)
        return
    
    # Build batch of log entries
    values = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        timestamp_ns = parse_log_line(line)
        values.append([timestamp_ns, line])
    
    if not values:
        print(f"  No log lines found in {filepath}", file=sys.stderr)
        return
    
    # Push to Loki
    payload = {
        "streams": [
            {
                "stream": {
                    "job": "app-logs",
                    "component": component,
                    "filename": os.path.basename(filepath)
                },
                "values": values
            }
        ]
    }
    
    try:
        response = requests.post(LOKI_URL, json=payload, timeout=10)
        if response.status_code == 204:
            print(f"  ✓ Ingested {len(values)} log lines", file=sys.stderr)
        else:
            print(f"  ✗ Failed: HTTP {response.status_code} - {response.text}", file=sys.stderr)
    except Exception as e:
        print(f"  ✗ Error: {e}", file=sys.stderr)

def main():
    """Ingest all log files."""
    print("Starting log ingestion to Loki...", file=sys.stderr)
    print(f"Log directory: {LOG_DIR}", file=sys.stderr)
    
    if not os.path.exists(LOG_DIR):
        print(f"ERROR: Log directory does not exist: {LOG_DIR}", file=sys.stderr)
        sys.exit(1)
    
    total_files = 0
    total_lines = 0
    
    for filepath, component in discover_log_files(LOG_DIR):
        ingest_file(filepath, component)
        total_files += 1
    
    print(f"\nIngestion complete! {total_files} files processed.", file=sys.stderr)
    
    # Output success JSON to stdout for TypeScript to parse
    print(json.dumps({"status": "success", "files_ingested": total_files}))

if __name__ == "__main__":
    main()
