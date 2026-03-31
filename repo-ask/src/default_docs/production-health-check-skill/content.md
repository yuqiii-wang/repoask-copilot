# Production Health Check Skill

This skill provides tools and guidance to run production health checks and fetch recent logs from production services.

Usage
- Use the included Python scripts in the `scripts/` folder to run API health checks and retrieve recent logs.
- Example commands:

```bash
python scripts/health_check.py --url https://prod.example.com/health --timeout 5
python scripts/get_logs.py --url https://prod.example.com/logs --lines 200
```

Security
- Ensure the scripts run in a secure environment with necessary credentials stored securely (env vars or secrets manager).
- Do not commit production secrets to the repository.

What it does
- `health_check.py`: performs HTTP requests to health endpoints and reports status codes, latency, and basic JSON validation.
- `get_logs.py`: fetches recent log lines from a logs API endpoint and prints them (supports tailing behavior).

Integration
- Can be invoked from CI/CD pipelines, runbooks, or by on-call engineers.

Notes
- The scripts are lightweight and use `requests`. Add authentication hooks as needed for your environment.
