"""Bounded queue drain and per-publisher request spacing."""

from unittest.mock import MagicMock

import pytest

from pipeline.image_scope import BACKFILL_END, BACKFILL_START, scope_result
from pipeline.images import backfill


def test_batch_scans_once_and_does_not_retry_failures_in_same_run():
    repository = MagicMock()
    repository.list_unqueued_image_candidates.return_value = [
        {"hn_id": 1, "url": "https://one.example/article"},
        {"hn_id": 2, "url": "https://two.example/article"},
        {"hn_id": 3, "url": "https://three.example/article"},
    ]
    ingester = MagicMock()
    ingester.ingest_article_image.side_effect = ["ready", "failed", "skipped"]
    assert backfill.run_batch(repository, ingester, 3) == {
        "scanned": 3, "ready": 1, "failed": 1, "skipped": 1, "superseded": 0,
        **scope_result(),
    }
    repository.list_unqueued_image_candidates.assert_called_once_with(
        3, max_attempts=3, stale_after_seconds=900, retry_after_seconds=3600,
        added_from=BACKFILL_START, added_before=BACKFILL_END,
    )
    assert ingester.ingest_article_image.call_count == 3
    ingester.ingest_article_image.assert_any_call(2, "https://two.example/article")


def test_unexpected_story_failure_does_not_stop_batch():
    repository = MagicMock()
    repository.list_unqueued_image_candidates.return_value = [
        {"hn_id": 1, "url": "https://one.example"},
        {"hn_id": 2, "url": "https://two.example"},
    ]
    ingester = MagicMock()
    ingester.ingest_article_image.side_effect = [RuntimeError("private detail"), "ready"]
    result = backfill.run_batch(repository, ingester, 2)
    assert result["failed"] == result["ready"] == 1
    assert ingester.ingest_article_image.call_count == 2


def test_a_later_batch_can_retry_without_a_loop_in_the_first():
    repository = MagicMock()
    repository.list_unqueued_image_candidates.side_effect = [
        [{"hn_id": 1, "url": "https://publisher.example/article"}],
        [{"hn_id": 1, "url": "https://publisher.example/article"}],
    ]
    ingester = MagicMock()
    ingester.ingest_article_image.side_effect = ["failed", "ready"]
    assert backfill.run_batch(repository, ingester, 1)["failed"] == 1
    assert backfill.run_batch(repository, ingester, 1)["ready"] == 1
    assert repository.list_unqueued_image_candidates.call_count == 2
    assert ingester.ingest_article_image.call_count == 2


def test_rate_limiter_spaces_each_hostname_including_redirect_target(monkeypatch):
    clock = [100.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr(backfill.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(backfill.time, "sleep", sleep)
    limiter = backfill.HostRateLimiter(2)
    limiter("https://publisher.example/article")
    limiter("https://cdn.example/image")
    limiter("https://publisher.example/redirect")
    assert sleeps == [2.0]
    clock[0] = 103.0
    limiter("https://cdn.example/redirect")
    assert sleeps == [2.0]
    limiter("https://cdn.example/second")
    assert sleeps == [2.0, 2.0]


def test_run_uses_fixed_day_backfill_without_inference_credentials(monkeypatch):
    from pipeline import backfill_images as advanced
    from pipeline import blob, image_metadata
    from pipeline.images import worker

    settings = MagicMock(batch_size=7, publisher_interval=2, timeout=8, max_redirects=3)
    monkeypatch.setattr(worker.ImageSettings, "from_env", lambda: settings)
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "hidden")
    monkeypatch.setenv("HACKSNAP_DATABASE_URL", "postgresql://mock.invalid/test")
    repository = MagicMock()
    repository_class = MagicMock(return_value=repository)
    uploader = MagicMock()
    uploader_class = MagicMock(return_value=uploader)
    fetcher = MagicMock()
    monkeypatch.setattr(backfill, "Repository", repository_class)
    monkeypatch.setattr(blob, "VercelBlobStore", uploader_class)
    monkeypatch.setattr(image_metadata, "PublicFetcher", MagicMock(return_value=fetcher))
    process = MagicMock(return_value={"failed": 0, **scope_result()})
    monkeypatch.setattr(advanced, "backfill_images", process)

    assert backfill.run() == process.return_value
    repository_class.assert_called_once_with("postgresql://mock.invalid/test")
    uploader_class.assert_called_once_with("hidden")
    assert process.call_args.args == (repository, uploader)
    assert process.call_args.kwargs["limit"] == 7
    assert process.call_args.kwargs["publisher_interval"] == 2
    assert process.call_args.kwargs["settings"] is settings


@pytest.mark.parametrize("limit", [0, 101])
def test_limit_stays_bounded_before_scanning(limit):
    repository = MagicMock()
    with pytest.raises(ValueError, match="limit"):
        backfill.run_batch(repository, MagicMock(), limit)
    repository.list_unqueued_image_candidates.assert_not_called()


def test_legacy_cli_exits_nonzero_on_image_failures(monkeypatch, capsys):
    monkeypatch.setattr(backfill, "run", lambda limit: {
        "publisher": 0, "generated": 0, "failed": 1, "skipped": 0,
    })
    assert backfill.main(["--limit", "2"]) == 1
    assert '"failed": 1' in capsys.readouterr().out
