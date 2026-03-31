#!/usr/bin/env python3
"""Simple health check script.

Performs an HTTP GET to a health endpoint and reports status, latency, and optionally validates JSON keys.
"""
import argparse
import os
import sys
import time
import requests


def parse_args():
    p = argparse.ArgumentParser(description="Run a simple HTTP health check")
    p.add_argument("--url", required=True, help="Health endpoint URL")
    p.add_argument("--timeout", type=float, default=5.0, help="Request timeout seconds")
    p.add_argument("--expect-key", action="append", help="JSON key expected in response body")
    return p.parse_args()


def main():
    args = parse_args()
    try:
        start = time.time()
        r = requests.get(args.url, timeout=args.timeout)
        latency = time.time() - start
    except Exception as e:
        print(f"ERROR: request failed: {e}")
        sys.exit(2)

    print(f"URL: {args.url}")
    print(f"Status: {r.status_code}")
    print(f"Latency: {latency:.3f}s")

    if args.expect_key:
        try:
            data = r.json()
        except Exception:
            print("ERROR: response is not valid JSON")
            sys.exit(3)
        missing = [k for k in args.expect_key if k not in data]
        if missing:
            print(f"MISSING KEYS: {missing}")
            sys.exit(4)
        print("All expected keys present")

    if 200 <= r.status_code < 300:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
