"""Check the SDK opt-out in a fresh process, before its import-time configuration."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("adapter", ["pipeline.blob", "pipeline.images.upload"])
@pytest.mark.parametrize("previous_value", [None, "0"])
def test_blob_import_disables_sdk_telemetry(adapter, previous_value):
    env = os.environ.copy()
    env.pop("VERCEL_TELEMETRY_DISABLED", None)
    if previous_value is not None:
        env["VERCEL_TELEMETRY_DISABLED"] = previous_value
    result = subprocess.run(
        [sys.executable, "-c", f"""
from unittest.mock import patch
import {adapter}
from vercel.internal.telemetry.client import TelemetryClient

with patch("httpx.Client") as http_client:
    client = TelemetryClient()
    client.track("blob_put", size_bytes=123, content_type="image/webp")
    assert client._events == []
    client.flush()
    client._flush_at_exit()
    http_client.assert_not_called()
"""],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
