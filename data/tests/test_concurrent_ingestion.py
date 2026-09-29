"""Concurrency regressions without live HN, model, or database requests."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock, get_ident
from uuid import uuid4

import httpx
import pytest
from click.testing import CliRunner

from hn_trending import cli, topic_filter


@pytest.fixture
def scan(monkeypatch):
    state = {"rows": [], "writes": 0, "finished": [], "filters": None}
    main_thread = get_ident()

    class HN:
        def __init__(self, client):
            self.client = client

        def top_story_ids(self):
            return [1, 2, 3, 4]

        def item(self, story_id):
            assert not self.client.is_closed
            return {
                "id": story_id, "type": "story", "time": 1,
                "title": f"AI story {story_id}", "score": 30, "descendants": 30,
            }

        def thread_comments(self, story, max_depth, on_progress=None):
            return []

    def start(url, filters):
        state["filters"] = filters
        return uuid4()

    def store(url, run_id, rows):
        assert get_ident() == main_thread
        state["writes"] += 1
        state["rows"].extend(rows)
        return len(rows), len(rows)

    monkeypatch.setenv("SUPABASE_PASSWORD", "offline-only")
    monkeypatch.setattr(cli, "HackerNewsClient", HN)
    monkeypatch.setattr(cli, "start_ingestion_run", start)
    monkeypatch.setattr(cli, "store_threads_and_snapshots", store)
    monkeypatch.setattr(cli, "finish_ingestion_run", lambda *args, **kw: state["finished"].append(kw))
    return HN, state


def test_stories_overlap_with_bounded_workers_and_preserve_rank(scan, monkeypatch):
    HN, state = scan
    pair = Barrier(2)
    second_row_ready = Event()
    lock = Lock()
    active = peak = 0
    completions = []
    make_row = cli.database_row

    def comments(self, story, *args, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        pair.wait(timeout=5)
        if story["id"] == 1:
            assert second_row_ready.wait(timeout=5)
        with lock:
            active -= 1
        return []

    def row(story, *args, **kwargs):
        result = make_row(story, *args, **kwargs)
        with lock:
            completions.append(story["id"])
        if story["id"] == 2:
            second_row_ready.set()
        return result

    monkeypatch.setattr(HN, "thread_comments", comments)
    monkeypatch.setattr(cli, "database_row", row)
    result = CliRunner().invoke(cli.main, ["--story-concurrency", "2"])
    assert result.exit_code == 0, result.output
    assert peak == 2
    assert completions.index(2) < completions.index(1)
    assert [r["hn_id"] for r in state["rows"]] == [1, 2, 3, 4]
    assert [r["top_story_rank"] for r in state["rows"]] == [1, 2, 3, 4]
    assert state["filters"]["story_concurrency"] == 2
    assert state["writes"] == 1
    assert state["finished"] == [{
        "status": "succeeded", "stories_examined": 4,
        "threads_matched": 4, "snapshots_inserted": 4,
    }]


def test_concurrency_one_preserves_sequential_story_processing(scan, monkeypatch):
    HN, state = scan
    order = []
    item = HN.item

    def metadata(self, story_id):
        order.append(("story", story_id))
        return item(self, story_id)

    def comments(self, story, *args, **kwargs):
        order.append(("comments", story["id"]))
        return []

    monkeypatch.setattr(HN, "item", metadata)
    monkeypatch.setattr(HN, "thread_comments", comments)
    result = CliRunner().invoke(cli.main, ["--story-concurrency", "1"])
    assert result.exit_code == 0, result.output
    assert order == [(kind, i) for i in range(1, 5) for kind in ("story", "comments")]
    assert state["writes"] == 1


def test_worker_failure_drains_started_stories_without_writing_or_scheduling_more(scan, monkeypatch):
    HN, state = scan
    pair = Barrier(2)
    failure_observed = Event()
    ended = []
    original_wait = cli.wait

    def observe_failure(*args, **kwargs):
        completed, pending = original_wait(*args, **kwargs)
        if any(future.exception() is not None for future in completed):
            failure_observed.set()
        return completed, pending

    def comments(self, story, *args, **kwargs):
        pair.wait(timeout=5)
        if story["id"] == 1:
            ended.append(1)
            raise RuntimeError("comment fetch failed")
        assert failure_observed.wait(timeout=5)
        assert not self.client.is_closed
        ended.append(story["id"])
        return []

    monkeypatch.setattr(cli, "wait", observe_failure)
    monkeypatch.setattr(HN, "thread_comments", comments)
    result = CliRunner().invoke(cli.main, ["--story-concurrency", "2"])
    assert result.exit_code == 1
    assert isinstance(result.exception, RuntimeError)
    assert sorted(ended) == [1, 2]
    assert state["writes"] == 0
    assert state["finished"] == [{
        "status": "failed", "stories_examined": 2, "threads_matched": 1,
        "snapshots_inserted": 0, "error": "comment fetch failed",
    }]


def test_parallel_scan_accounts_for_skipped_filtered_and_matched_stories(scan, monkeypatch):
    HN, state = scan
    item = HN.item

    def metadata(self, story_id):
        if story_id == 1:
            return None
        story = item(self, story_id)
        if story_id == 2:
            story["score"] = 0
        return story

    monkeypatch.setattr(HN, "item", metadata)
    result = CliRunner().invoke(cli.main, ["--min-points", "20"])
    assert result.exit_code == 0, result.output
    assert "detected=3, filtered=1, skipped=1, matched=2" in result.output
    assert [r["top_story_rank"] for r in state["rows"]] == [3, 4]
    assert state["finished"][0]["stories_examined"] == 4


def test_empty_scan_finishes_without_workers(scan, monkeypatch):
    HN, state = scan
    monkeypatch.setattr(HN, "top_story_ids", lambda self: [])
    result = CliRunner().invoke(cli.main, [])
    assert result.exit_code == 0, result.output
    assert state["finished"][0]["stories_examined"] == 0
    assert state["rows"] == []


@pytest.mark.parametrize("value", ["0", "-1", "17"])
def test_invalid_concurrency_rejected_before_run_starts(scan, value):
    _, state = scan
    result = CliRunner().invoke(cli.main, ["--story-concurrency", value])
    assert result.exit_code == 2
    assert state["filters"] is None


def test_concurrent_classifications_share_retry_cooldown(monkeypatch):
    """Both callers enter together; one title's retry must finish before the other."""
    clock = [1000.0]
    requests, sleeps = [], []
    start = Barrier(2)
    contention = Event()

    class ObservedLock:
        def __init__(self):
            self.lock = Lock()

        def __enter__(self):
            if self.lock.locked():
                contention.set()
            self.lock.acquire()

        def __exit__(self, *args):
            self.lock.release()

    monkeypatch.setattr(topic_filter, "Lock", ObservedLock)

    def sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds

    def respond(request):
        import json
        payload = json.loads(request.content)
        title = json.loads(payload["messages"][1]["content"])["title"]
        requests.append((title, clock[0]))
        if len(requests) == 1:
            assert contention.wait(timeout=5)
            return httpx.Response(429, headers={"Retry-After": "45"})
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop",
            "message": {"content": '{"relevant": true, "category": "agents_coding"}'},
        }]})

    monkeypatch.setattr(topic_filter.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(topic_filter.time, "sleep", sleep)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        classifier = topic_filter.TitleTopicClassifier("offline-key", client=client)

        def classify(title):
            start.wait(timeout=5)
            return classifier.classify(title)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(classify, ["AI first", "AI second"]))
    assert all(result.relevant for result in results)
    assert requests[0][0] == requests[1][0]
    assert requests[2][0] != requests[1][0]
    assert [timestamp for _, timestamp in requests] == [1000.0, 1045.0, 1050.0]
    assert sleeps == [45.0, 5.0]


def test_classifier_failure_stops_waiting_callers(scan, monkeypatch):
    HN, state = scan
    metadata_ready = Barrier(4)
    item = HN.item
    calls = []

    def metadata(self, story_id):
        result = item(self, story_id)
        metadata_ready.wait(timeout=5)
        return result

    class FailingClassifier:
        model = "offline-model"

        def __init__(self, *args, **kwargs):
            pass

        def classify(self, title):
            calls.append(title)
            raise RuntimeError("terminal model error")

    monkeypatch.setenv("MODAL_LLM_API_KEY", "offline-key")
    monkeypatch.setattr(HN, "item", metadata)
    monkeypatch.setattr(cli, "TitleTopicClassifier", FailingClassifier)
    monkeypatch.setattr(cli, "get_category_assignments", lambda *args: {})
    result = CliRunner().invoke(cli.main, ["--classify-topic"])
    assert result.exit_code == 1
    assert str(result.exception) == "terminal model error"
    assert len(calls) == 1
    assert state["writes"] == 0
    assert state["finished"][0]["stories_examined"] == 4
    assert state["finished"][0]["status"] == "failed"
