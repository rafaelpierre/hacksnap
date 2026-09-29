"""Synchronization-based regressions for refresh concurrency and inference warm-up."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock
from types import SimpleNamespace

import httpx
import pytest
from test_pipeline import FakeRepository, FakeSummarizer, output, process_story, story

import pipeline.refresh as refresh_module
from pipeline.models import CommentSentiment, StorySummary
from pipeline.prompts import DISCUSSION_REFRESH_PROMPT, SENTIMENT_PROMPT, SYSTEM_PROMPT
from pipeline.summarise import ModalSummarizer


@pytest.mark.parametrize("parallelism, total", [(3, 9), (15, 45)])
def test_refresh_runs_bounded_parallel_jobs_and_waits_before_recording_ranks(
    monkeypatch, parallelism, total,
):
    assert refresh_module.MAX_PARALLELISM == 15
    monkeypatch.setattr(refresh_module, "MAX_PARALLELISM", parallelism)
    batch = Barrier(parallelism, timeout=5)
    lock = Lock()
    active = peak = 0
    completed = []
    repo = FakeRepository([story(i) for i in range(total)])

    def process(item, repository, fetcher, summarizer, comment_budget, *, image_enabled):
        nonlocal active, peak
        assert repository is repo
        assert comment_budget == 1234
        assert image_enabled is True
        with lock:
            active += 1
            peak = max(peak, active)
        batch.wait()
        # Keep the wave active until every worker has entered.
        with lock:
            active -= 1
            completed.append(item["hn_id"])
        batch.wait()
        return "failed" if item["hn_id"] == 0 else "generated"

    def record_ranks():
        assert active == 0
        assert sorted(completed) == list(range(total))
        repo.rank_observations.append(True)

    monkeypatch.setattr(refresh_module, "process_story", process)
    repo.record_rank_history = record_ranks
    counts = refresh_module.refresh(repo, None, None, 1234, image_enabled=True)
    assert counts["generated"] == total - 1
    assert counts["failed"] == 1
    assert sum(counts.values()) == total
    assert peak == parallelism
    assert repo.rank_observations == [True]


@pytest.mark.parametrize("first_status", [200, 429])
def test_first_request_finishes_before_parallel_inference_even_when_it_fails(first_status):
    first_started, release_first, all_waiting = Event(), Event(), Event()
    state_lock = Lock()
    parallel = Barrier(3, timeout=5)
    sessions = []
    entered = 0

    class ObservedLock:
        """Observe contenders before they block, without timing-based assertions."""
        def __init__(self):
            self.lock = Lock()

        def __enter__(self):
            nonlocal entered
            with state_lock:
                entered += 1
                if entered == 4:
                    all_waiting.set()
            self.lock.acquire()

        def __exit__(self, *args):
            self.lock.release()

    def handler(request):
        with state_lock:
            sessions.append(request.headers["Modal-Session-Id"])
            index = len(sessions)
        if index == 1:
            first_started.set()
            assert release_first.wait(5)
            if first_status != 200:
                return httpx.Response(first_status)
        else:
            parallel.wait()
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": '{"sentiment": 0}'},
        }]})

    comments = [{"id": 1, "text": "Evidence", "parent": 100, "depth": 1}]
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake")
        model._warmup_lock = ObservedLock()
        with ThreadPoolExecutor(max_workers=4) as executor:
            first = executor.submit(model.estimate_sentiment, comments)
            try:
                assert first_started.wait(5)
                rest = [executor.submit(model.estimate_sentiment, comments) for _ in range(3)]
                assert all_waiting.wait(5)
                assert len(sessions) == 1
            finally:
                release_first.set()
            if first_status == 200:
                assert first.result(timeout=5).sentiment == 0
            else:
                with pytest.raises(httpx.HTTPStatusError):
                    first.result(timeout=5)
            assert [future.result(timeout=5).sentiment for future in rest] == [0, 0, 0]
    assert len(sessions) == 4  # Warm-up is useful work, with no extra request.
    assert len(set(sessions)) == 1


def test_cached_and_unavailable_stories_do_not_consume_warmup():
    repo = FakeRepository([story(i) for i in range(3)])
    fetcher = SimpleNamespace(fetch=lambda _: "article")
    assert process_story(repo.stories[0], repo, fetcher, FakeSummarizer()) == "generated"
    repo.stories[1]["full_raw_text_contents"] = None
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": json.dumps({"sentiment": 0})},
        }]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake")
        assert process_story(repo.stories[0], repo, fetcher, model) == "unchanged"
        assert process_story(repo.stories[1], repo, fetcher, model) == "unavailable"
        assert not model._warmup_states
        assert not requests
        # The first real inference can be a sentiment refresh as well as a summary.
        model.estimate_sentiment([{"id": 1, "text": "Evidence", "parent": 100, "depth": 1}])
        assert all(state.is_set() for state in model._warmup_states.values())
        assert len(requests) == 1


def test_empty_refresh_does_not_infer_and_still_records_ranks():
    repo = FakeRepository()
    repo.stories = []
    counts = refresh_module.refresh(repo, None, None)
    assert sum(counts.values()) == 0
    assert repo.rank_observations == [[]]


def test_parallel_inference_failure_does_not_block_other_stories():
    repo = FakeRepository([story(i) for i in range(10)])
    for item in repo.stories:
        item["title"] = str(item["hn_id"])

    class PartialFailure(FakeSummarizer):
        def summarize(self, source):
            if source["title"] == "3":
                raise ValueError("invalid model response")
            return StorySummary.model_validate(output())

    counts = refresh_module.refresh(
        repo, SimpleNamespace(fetch=lambda _: "article"), PartialFailure(),
    )
    assert counts["generated"] == 9
    assert counts["failed"] == 1
    assert set(repo.saved) == set(range(10)) - {3}
    assert len(repo.rank_observations) == 1


def test_refresh_enriches_fifty_stories_without_attempting_the_fifty_first():
    repo = FakeRepository([story(i) for i in range(60)])
    counts = refresh_module.refresh(
        repo, SimpleNamespace(fetch=lambda _: "article"), FakeSummarizer(),
    )
    assert counts["generated"] == 50
    assert sum(counts.values()) == 50
    assert set(repo.saved) == set(range(50))
    # Rank history still captures every eligible story, beyond the workload cap.
    assert repo.rank_observations == [list(range(60))]


@pytest.mark.parametrize("first_status", [200, 429])
def test_each_prompt_gets_a_completed_warmup_before_its_parallel_requests(first_status):
    """A finished discussion refresh must not release a cold summary burst."""
    first_started, release_first, all_waiting = Event(), Event(), Event()
    state_lock = Lock()
    parallel = Barrier(3, timeout=5)
    calls = []
    entered = 0

    class ObservedLock:
        def __init__(self):
            self.lock = Lock()

        def __enter__(self):
            nonlocal entered
            with state_lock:
                entered += 1
                if entered == 4:
                    all_waiting.set()
            self.lock.acquire()

        def __exit__(self, *args):
            self.lock.release()

    def handler(request):
        prompt = json.loads(request.content)["messages"][0]["content"]
        with state_lock:
            calls.append((prompt, request.headers["Modal-Session-Id"]))
            index = sum(p == SYSTEM_PROMPT for p, _ in calls)
        if prompt == SYSTEM_PROMPT:
            if index == 1:
                first_started.set()
                assert release_first.wait(5)
                if first_status != 200:
                    return httpx.Response(first_status)
            else:
                parallel.wait()
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": '{"sentiment": 0}'},
        }]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake")
        # Use a small response schema to isolate prompt warm-up from validation.
        for prompt in (DISCUSSION_REFRESH_PROMPT, SENTIMENT_PROMPT):
            model._infer({}, prompt, CommentSentiment, "test")
        model._warmup_lock = ObservedLock()
        with ThreadPoolExecutor(max_workers=4) as executor:
            first = executor.submit(model._infer, {}, SYSTEM_PROMPT, CommentSentiment, "test")
            try:
                assert first_started.wait(5)
                rest = [executor.submit(
                    model._infer, {}, SYSTEM_PROMPT, CommentSentiment, "test",
                ) for _ in range(3)]
                assert all_waiting.wait(5)
                assert len(calls) == 3  # Two other prompts plus one summary warm-up.
            finally:
                release_first.set()
            if first_status == 200:
                assert first.result(timeout=5).sentiment == 0
            else:
                with pytest.raises(httpx.HTTPStatusError):
                    first.result(timeout=5)
            assert [future.result(timeout=5).sentiment for future in rest] == [0, 0, 0]
    assert len(calls) == 6
    assert len({session for _, session in calls}) == 1
