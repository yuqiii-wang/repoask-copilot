"""
Logtail dummy server — thin entry point.

All logic lives in the logtail/ package:
  logtail/config.py   – LOGS_DIR and regex constants
  logtail/reader.py   – log file discovery and reading
  logtail/filters.py  – time / text filtering helpers
  logtail/routes.py   – FastAPI app and route handlers

Runs on port 8093 over HTTPS using a self-signed certificate.
Generate the cert first (only needs to be done once):
    python -m logtail.gen_cert
"""

import os, sys
from pathlib import Path

# Ensure the dummy-data-for-test/ directory is on the path so that
# template_utils and the logtail package are importable regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logtail.routes import app  # noqa: F401  re-export for uvicorn

_HERE = Path(__file__).parent
_CERT_FILE = _HERE / "certs" / "logtail.crt"
_KEY_FILE = _HERE / "certs" / "logtail.key"

if __name__ == "__main__":
    import uvicorn

    if not _CERT_FILE.exists() or not _KEY_FILE.exists():
        raise FileNotFoundError(
            "TLS certificate not found. Run  python gen_cert.py  first."
        )

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8093,
        ssl_certfile=str(_CERT_FILE),
        ssl_keyfile=str(_KEY_FILE),
    )
