"""Prove overlap, bounded claims and shared publisher pacing without network access."""

import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from threading import Barrier, Event, Lock

import pytest

from pipeline.image_metadata import PublicFetcher
from pipeline.images import worker


@pytest.mark.parametrize("concurrency", [1, 4])
def test_image_jobs_overlap_without_claiming_queued_leases(monkeypatch, caplog, concurrency):
    caplog.set_level("INFO", logger="hacksnap.images")
    trace = ContextVar("test_trace", default=None)
    trace.set("batch-trace")
    wave = Barrier(concurrency, timeout=5)
    guard = Lock()
    active = peak = 0
    claimed = set()
    finished = set()
    total = concurrency * 3

    class Repository:
        def list_image_candidates(self, **kwargs):
            return []

        def claim_pending_images(self, **kwargs):
            assert kwargs["limit"] == 1
            assert kwargs["lease_seconds"] == worker.ImageSettings().lease_seconds(2 * concurrency)
            with guard:
                assert len(claimed - finished) < concurrency
                story_id = len(claimed)
                claimed.add(story_id)
            return [{"story_id": story_id, "lease_token": str(story_id)}]

        def mark_image_failed(self, story_id, *args, **kwargs):
            assert story_id == 0

    def process(job, *args, **kwargs):
        nonlocal active, peak
        assert trace.get() == "batch-trace"
        with guard:
            active += 1
            peak = max(peak, active)
        wave.wait()
        with guard:
            active -= 1
            finished.add(job["story_id"])
        wave.wait()
        if job["story_id"] == 0:
            raise ValueError("private diagnostic")
        return "publisher"

    monkeypatch.setattr(worker, "process_image_job", process)
    result = worker.process_pending_images(
        Repository(), None, limit=total, settings=worker.ImageSettings(concurrency=concurrency),
    )
    assert peak == concurrency
    assert len(claimed) == total
    assert finished == claimed
    assert result["failed"] == 1
    assert result["publisher"] == total - 1
    events = [json.loads(record.message) for record in caplog.records]
    batch = next(event for event in events if event.get("event") == "image_batch_completed")
    assert batch["processed"] == total
    assert batch["items_per_minute"] > 0
    assert batch["concurrency"] == concurrency
    assert "private diagnostic" not in caplog.text


def test_shared_host_wait_does_not_block_other_publishers():
    waiting, release = Event(), Event()
    clock_guard = Lock()
    now = 0.0
    waits = []

    def clock():
        with clock_guard:
            return now

    def sleep(delay):
        nonlocal now
        waits.append(delay)
        waiting.set()
        assert release.wait(5)
        with clock_guard:
            now += delay

    fetcher = PublicFetcher(publisher_interval=2, clock=clock, sleep=sleep)
    fetcher._pace("same.example")
    with ThreadPoolExecutor(max_workers=3) as executor:
        first = executor.submit(fetcher._pace, "same.example")
        try:
            assert waiting.wait(5)
            second = executor.submit(fetcher._pace, "same.example")
            other = executor.submit(fetcher._pace, "other.example")
            assert other.result(timeout=5) == 0
        finally:
            release.set()
        assert first.result(timeout=5) >= 2
        assert second.result(timeout=5) >= 2
    assert waits == [2, 2]
    assert fetcher._next_request["same.example"] == 6


def test_image_concurrency_configuration(monkeypatch):
    assert worker.ImageSettings().concurrency == 4
    monkeypatch.setenv("HACKSNAP_IMAGE_CONCURRENCY", "8")
    assert worker.ImageSettings.from_env().concurrency == 8
    monkeypatch.setenv("HACKSNAP_IMAGE_CONCURRENCY", "9")
    with pytest.raises(ValueError, match="CONCURRENCY"):
        worker.ImageSettings.from_env()


def test_excessive_lease_budget_fails_before_claiming():
    with pytest.raises(ValueError, match="lease longer than 3600"):
        worker.process_pending_images(
            None, None, settings=worker.ImageSettings(
                concurrency=8, max_candidates=20, max_redirects=5, publisher_interval=10,
            ),
        )
