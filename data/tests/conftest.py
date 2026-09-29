"""Keep test runs independent of local Logfire credentials."""

import pytest


@pytest.fixture(autouse=True)
def isolate_logfire_credentials(monkeypatch, tmp_path):
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    monkeypatch.setenv("LOGFIRE_CREDENTIALS_DIR", str(tmp_path / ".logfire"))
