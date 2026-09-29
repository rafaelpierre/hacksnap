from unittest.mock import Mock

import pytest

import modal_app
from pipeline import refresh


@pytest.fixture
def handoff(monkeypatch):
    result = {"generated": 0, "unchanged": 10}
    run = Mock(return_value=result)
    spawn = Mock()
    monkeypatch.setattr(refresh, "run", run)
    monkeypatch.setattr(modal_app.refresh_article_images, "spawn", spawn)
    monkeypatch.setenv("HACKSNAP_IMAGES_ENABLED", "true")
    return run, spawn, result


def test_images_start_after_summary_completion_even_on_quiet_runs(handoff):
    run, spawn, result = handoff
    calls = Mock()
    calls.attach_mock(run, "summary")
    calls.attach_mock(spawn, "images")

    assert modal_app.refresh_hacksnap.local() is result
    assert [call[0] for call in calls.mock_calls] == ["summary", "images"]
    spawn.assert_called_once_with()


@pytest.mark.parametrize("enabled", [None, "", "false"])
def test_disabled_images_do_not_dispatch(handoff, monkeypatch, enabled):
    _run, spawn, result = handoff
    if enabled is None:
        monkeypatch.delenv("HACKSNAP_IMAGES_ENABLED")
    else:
        monkeypatch.setenv("HACKSNAP_IMAGES_ENABLED", enabled)

    assert modal_app.refresh_hacksnap.local() is result
    spawn.assert_not_called()


def test_summary_failure_does_not_dispatch(handoff):
    run, spawn, _result = handoff
    run.side_effect = RuntimeError("summary failed")

    with pytest.raises(RuntimeError, match="summary failed"):
        modal_app.refresh_hacksnap.local()
    spawn.assert_not_called()


def test_dispatch_failure_preserves_summary_result_and_sanitizes_log(handoff, caplog):
    _run, spawn, result = handoff
    spawn.side_effect = RuntimeError("private-service-token")

    assert modal_app.refresh_hacksnap.local() is result
    assert "image_dispatch_failed error_type=RuntimeError" in caplog.text
    assert "private-service-token" not in caplog.text
