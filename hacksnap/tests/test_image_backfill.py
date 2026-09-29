"""Bounded queue drain and per-publisher request spacing."""

from unittest.mock import MagicMock

import pytest

from pipeline.images import backfill


def test_batch_scans_once_and_does_not_retry_failures_in_same_run():
    repository = MagicMock()
    repository.list_image_candidates.return_value = [
        {"hn_id": 1, "url": "https://one.example/article"},
        {"hn_id": 2, "url": "https://two.example/article"},
        {"hn_id": 3, "url": "https://three.example/article"},
    ]
    ingester = MagicMock()
    ingester.ingest_article_image.side_effect = ["ready", "failed", "skipped"]
    assert backfill.run_batch(repository, ingester, 3) == {
        "scanned": 3, "ready": 1, "failed": 1, "skipped": 1, "superseded": 0,
    }
    repository.list_image_candidates.assert_called_once_with(
        3, max_attempts=3, stale_after_seconds=900, retry_after_seconds=3600,
    )
    assert ingester.ingest_article_image.call_count == 3
    ingester.ingest_article_image.assert_any_call(2, "https://two.example/article")


def test_unexpected_story_failure_does_not_stop_batch():
    repository = MagicMock()
    repository.list_image_candidates.return_value = [
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
    repository.list_image_candidates.side_effect = [
        [{"hn_id": 1, "url": "https://publisher.example/article"}],
        [{"hn_id": 1, "url": "https://publisher.example/article"}],
    ]
    ingester = MagicMock()
    ingester.ingest_article_image.side_effect = ["failed", "ready"]
    assert backfill.run_batch(repository, ingester, 1)["failed"] == 1
    assert backfill.run_batch(repository, ingester, 1)["ready"] == 1
    assert repository.list_image_candidates.call_count == 2
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


def test_run_uses_image_settings_without_inference_credentials(monkeypatch):
    settings = MagicMock(
        database_url="postgresql://mock.invalid/test", blob_token="hidden",
        limits=MagicMock(), batch_size=7, max_attempts=4,
        stale_after_seconds=1000, retry_after_seconds=5400,
        publisher_interval_seconds=3,
    )
    monkeypatch.setattr(backfill.ImageSettings, "from_env", lambda: settings)
    repository = MagicMock()
    repository.list_image_candidates.return_value = []
    repository_class = MagicMock(return_value=repository)
    uploader_class = MagicMock()
    ingester_class = MagicMock()
    monkeypatch.setattr(backfill, "Repository", repository_class)
    monkeypatch.setattr(backfill, "BlobUploader", uploader_class)
    monkeypatch.setattr(backfill, "ImageIngester", ingester_class)
    assert backfill.run() == {
        "scanned": 0, "ready": 0, "failed": 0, "skipped": 0, "superseded": 0,
        "failure_reasons": {},
    }
    repository_class.assert_called_once_with(settings.database_url)
    uploader_class.assert_called_once_with(settings.blob_token)
    assert isinstance(ingester_class.call_args.kwargs["before_request"], backfill.HostRateLimiter)
    repository.list_image_candidates.assert_called_once_with(
        7, max_attempts=4, stale_after_seconds=1000, retry_after_seconds=5400,
    )


@pytest.mark.parametrize("limit", [0, 101])
def test_limit_stays_bounded_before_scanning(limit):
    repository = MagicMock()
    with pytest.raises(ValueError, match="limit"):
        backfill.run_batch(repository, MagicMock(), limit)
    repository.list_image_candidates.assert_not_called()
