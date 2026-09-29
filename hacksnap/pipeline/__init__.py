"""Hacksnap enrichment; HN ingestion remains in data/."""

import os

# The SDK reads this once at import time, before either Blob adapter is loaded.
os.environ["VERCEL_TELEMETRY_DISABLED"] = "1"
