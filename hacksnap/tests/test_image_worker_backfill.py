"""Backfill restart, publisher pacing, and isolation without network or credentials."""

from unittest.mock import Mock

import pytest

from pipeline.backfill_images import backfill_images, database_url_from_env, main


class Repository:
    def __init__(self, rows):
        self.rows = {row["story_id"]: dict(row) for row in rows}
        self.claimed = set()
        self.enqueued = []

    def list_image_candidates(self, **options):
        return [
            dict(row) for story_id, row in sorted(self.rows.items())
            if story_id > options["after_id"]
            and (row.get("image_status") != "ready" or options["reprocess_ready"])
        ][:options["limit"]]

    def enqueue_image(self, story_id, url, **options):
        self.enqueued.append((story_id, options))

    def claim_pending_images(self, *, limit, story_ids, max_attempts=3, lease_seconds=300):
        story_id = story_ids[0]
        if story_id in self.claimed:
            return []
        self.claimed.add(story_id)
        return [{**self.rows[story_id], "lease_token": str(story_id)}]

    def mark_image_failed(self, story_id, token, reason, **options):
        self.rows[story_id]["image_status"] = "failed"
        self.claimed.discard(story_id)


def rows():
    return [
        {"story_id": 1, "article_url": "https://publisher.test/a"},
        {"story_id": 2, "article_url": "https://other.test/b"},
        {"story_id": 3, "article_url": "https://publisher.test/c"},
    ]


def finish(job, repository, uploader, **options):
    repository.rows[job["story_id"]]["image_status"] = "ready"
    repository.claimed.discard(job["story_id"])
    return "publisher"


def test_completed_rows_are_restart_checkpoints():
    repository = Repository(rows())
    calls = []

    def interrupted(job, *args, **kwargs):
        calls.append(job["story_id"])
        if job["story_id"] == 2:
            raise KeyboardInterrupt
        return finish(job, *args, **kwargs)

    with pytest.raises(KeyboardInterrupt):
        backfill_images(repository, None, process_job=interrupted)
    assert calls == [1, 2]
    repository.claimed.clear()  # Simulate expiry of the interrupted job's durable lease.
    result = backfill_images(repository, None, process_job=finish)
    assert result["processed"] == 2
    assert result["publisher_derived"] == 2
    assert all(row["image_status"] == "ready" for row in repository.rows.values())


def test_paces_same_publisher_and_claims_only_after_wait():
    repository = Repository(rows())
    now = [0.0]
    sleeps = []

    def sleep(seconds):
        assert 3 not in repository.claimed
        sleeps.append(seconds)
        now[0] += seconds

    result = backfill_images(repository, None, process_job=finish,
                             clock=lambda: now[0], sleep=sleep)
    assert result["processed"] == 3
    assert sleeps == [2.0]


def test_failure_does_not_stop_remaining_stories_or_leak_exception(caplog):
    repository = Repository(rows()[:2])

    def fail_one(job, *args, **kwargs):
        if job["story_id"] == 1:
            raise RuntimeError("https://publisher.test?token=SECRET")
        return finish(job, *args, **kwargs)

    result = backfill_images(repository, None, process_job=fail_one)
    assert result["failed"] == 1
    assert result["publisher_derived"] == 1
    assert repository.rows[1]["image_status"] == "failed"
    assert "SECRET" not in caplog.text


def test_dry_run_is_read_only_and_bounded():
    repository = Repository(rows())
    processor = Mock()
    result = backfill_images(repository, None, process_job=processor, limit=1,
                             after_id=1, dry_run=True)
    assert result["selected"] == 1
    assert result["next_after_id"] == 2
    assert result["processed"] == 0
    assert repository.enqueued == []
    assert not repository.claimed
    processor.assert_not_called()


def test_duplicate_claim_is_skipped():
    repository = Repository(rows()[:1])
    repository.claimed.add(1)
    processor = Mock()
    result = backfill_images(repository, None, process_job=processor)
    assert result["skipped"] == 1
    assert result["processed"] == 0
    processor.assert_not_called()


def test_reprocess_ready_requires_explicit_flag():
    repository = Repository([{**rows()[0], "image_status": "ready"}])
    result = backfill_images(repository, None, process_job=finish)
    assert result["selected"] == 0
    result = backfill_images(repository, None, process_job=finish, reprocess_ready=True,
                             include_failed=True)
    assert result["processed"] == 1
    assert repository.enqueued == [(1, {"force": False, "reprocess_ready": True})]


@pytest.mark.parametrize("options", [{"limit": 0}, {"limit": 101}, {"after_id": -1},
                                     {"publisher_interval": 0}, {"publisher_interval": 11}, {"publisher_interval": float("nan")}])
def test_rejects_unbounded_arguments_before_query(options):
    repository = Mock()
    with pytest.raises(ValueError):
        backfill_images(repository, None, process_job=finish, **options)
    repository.list_image_candidates.assert_not_called()


def test_database_settings_need_no_llm_credentials(monkeypatch):
    monkeypatch.setenv("HACKSNAP_DATABASE_URL", "postgresql://local/test")
    monkeypatch.delenv("MODAL_LLM_API_KEY", raising=False)
    assert database_url_from_env() == "postgresql://local/test"


def test_cli_rejects_invalid_limit_before_accessing_database():
    with pytest.raises(SystemExit) as error:
        main(["--limit", "1000"])
    assert error.value.code == 2
