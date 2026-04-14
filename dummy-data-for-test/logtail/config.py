import os
import re

# Resolve path relative to the dummy-data-for-test/ directory (parent of this package)
_PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
_BASE_DIR = os.path.dirname(_PACKAGE_DIR)

LOGS_DIR: str = os.path.join(_BASE_DIR, "dummy-trading-system", "logs")

LOG_TIMESTAMP_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})")
TIMESTAMP_FMT = "%Y-%m-%d %H:%M:%S.%f"
TS_FILENAME_RE = re.compile(r"^(.+)-(\d{17})\.log$")
HHMM_RE = re.compile(r"^(\d{1,2}):(\d{2})$")
