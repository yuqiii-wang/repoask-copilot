#!/usr/bin/env python3
"""Fetch recent logs from a logs API endpoint.

This script is a simple example that performs an HTTP request to a logs endpoint
and prints the last N lines. Authentication hooks can be added as needed.
"""
import argparse
import sys
import requests


def parse_args():
    p = argparse.ArgumentParser(description="Fetch recent logs from logs API")
    p.add_argument("--url", required=True, help="Logs endpoint URL")
    p.add_argument("--lines", type=int, default=200, help="Number of lines to show")
    p.add_argument("--timeout", type=float, default=10.0, help="Request timeout seconds")
    return p.parse_args()


def main():
    args = parse_args()
    try:
        r = requests.get(args.url, timeout=args.timeout)
    except Exception as e:
        print(f"ERROR: request failed: {e}")
        sys.exit(2)

    if r.status_code != 200:
        print(f"ERROR: server returned status {r.status_code}")
        sys.exit(1)

    text = r.text
    lines = text.splitlines()
    tail = lines[-args.lines:]
    print("\n".join(tail))


if __name__ == "__main__":
    main()
