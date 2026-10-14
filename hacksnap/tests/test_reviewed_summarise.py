"""Exercise the production adapter and publication boundary without live writes."""
import asyncio
import copy
import importlib
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from types import SimpleNamespace

import pytest
from test_editorial_review import verdict
from test_pipeline import FakeRepository, FakeSummarizer, story

from pipeline.config import Settings
from pipeline.editorial_review import EditorialReview
from pipeline.models import CommentSentiment
from pipeline.refresh import process_story
from pipeline.reviewed_summarise import EditorialRejected, ReviewedSummarizer
from pipeline.summarise import RoutedSummarizer

pytest_plugins = ["test_editorial_review"]


@pytest.fixture
def settings():
    return Settings(database_url="unused", llm_base_url="https://writer.invalid/v1",
                    llm_model="writer", llm_api_key="writer-secret",
                    sentiment_base_url="https://reviewer.invalid/v1", sentiment_model="reviewer",
                    sentiment_api_key="reviewer-secret")


@pytest.fixture
def inference(monkeypatch, draft, source):
    state = SimpleNamespace(clients=[], reject=False, fail=False)

    class Client:
        def __init__(self, **config):
            self.config, self.calls, self.closed = config, [], False
            state.clients.append(self)

        async def infer(self, role, prompt, payload, schema):
            self.loop = asyncio.get_running_loop()
            self.calls.append({"role": role, "model": self.config["model"]})
            if state.fail:
                raise TimeoutError("inference timeout")
            if role != "reviewer":
                return draft if schema.__name__ == "GeneratedStorySummary" else draft.discussion_analysis
            value = payload["draft"]
            review = verdict(SimpleNamespace(model_dump=lambda: value), revise=state.reject)
            for check in review.checks:
                evidence = check.evidence[0]
                evidence.source, evidence.comment_id = "comment", 10
                evidence.quote = source["comments"][0]["text"]
            if state.reject:
                review.findings[0].path = next(iter(payload["prose_fields"]))
                evidence = review.findings[0].evidence[0]
                evidence.source, evidence.comment_id = "comment", 10
                evidence.quote = source["comments"][0]["text"]
            return EditorialReview.model_validate(review.model_dump())

        async def close(self):
            self.closed = True

    monkeypatch.setattr("pipeline.reviewed_summarise.AgentInference", Client)
    return state


def item(source):
    return {**story(), "full_raw_text_contents": json.dumps({"story": {"id": 100},
        "comments": [{"depth": 1, "item": {"id": 10, "parent": 100,
            "by": "handle_10", "text": source["comments"][0]["text"]}}]})}


def test_scheduled_run_uses_review_before_publication(monkeypatch, settings, inference, source):
    module = importlib.import_module("pipeline.refresh")
    repo = FakeRepository([item(source)])
    monkeypatch.setattr(module.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(module, "Repository", lambda _: repo)
    monkeypatch.setattr(module, "KestrelFetcher", lambda *a: SimpleNamespace(fetch=lambda _: source["article"]))
    monkeypatch.setattr(module, "ModalSummarizer", lambda *a: FakeSummarizer())
    assert module.run()["generated"] == 1
    assert [call["role"] for c in inference.clients for call in c.calls] == ["writer", "reviewer"]
    assert inference.clients[1].config["effort"] == "high"
    assert all(c.closed for c in inference.clients)
    assert repo.saved[100]["discussion_analysis_metadata"].prompt_version.startswith("reviewed-v1-")
    assert repo.saved[100]["summary"].sentiment == -1


@pytest.mark.parametrize("failure", ["reject", "fail"])
def test_failed_review_never_publishes_or_overwrites(failure, settings, inference, source):
    repo = FakeRepository([item(source)])
    adapter = ReviewedSummarizer(settings)
    model = RoutedSummarizer(adapter, SimpleNamespace(model="sentiment",
        estimate_sentiment=lambda _: CommentSentiment(sentiment=0)))
    fetcher = SimpleNamespace(fetch=lambda _: source["article"])
    setattr(inference, failure, True)
    assert process_story(item(source), repo, fetcher, model) == "failed"
    assert not repo.saved
    assert all(c.closed for c in inference.clients)
    setattr(inference, failure, False)
    assert process_story(item(source), repo, fetcher, model) == "generated"
    before = copy.deepcopy(repo.saved)
    # A reviewer-model change invalidates the discussion cache without refetching articles.
    revised = RoutedSummarizer(ReviewedSummarizer(replace(settings, sentiment_model="new-reviewer")), model.sentiment)
    setattr(inference, failure, True)
    assert process_story(item(source), repo, None, revised) == "failed"
    assert repo.saved == before
    assert all(c.closed for c in inference.clients)


def test_initial_result_primes_reviewed_refresh_cache(settings, inference, source):
    repo = FakeRepository([item(source)])
    model = RoutedSummarizer(ReviewedSummarizer(settings), FakeSummarizer())
    assert process_story(item(source), repo, SimpleNamespace(fetch=lambda _: source["article"]), model) == "generated"
    assert process_story(item(source), repo, None, model) == "unchanged"
    assert len(inference.clients) == 2
    changed = RoutedSummarizer(ReviewedSummarizer(replace(settings, sentiment_model="new-reviewer")), model.sentiment)
    assert process_story(item(source), repo, None, changed) == "analysis_updated"
    assert len(inference.clients) == 4
    assert process_story(item(source), repo, None, changed) == "unchanged"


def test_concurrent_stories_get_separate_clients_and_event_loops(settings, inference, source):
    adapter = ReviewedSummarizer(settings)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(adapter.summarize, [source] * 3))
    assert len(results) == 3 and len(inference.clients) == 6
    assert len({id(c.loop) for c in inference.clients}) == 3
    assert all(c.closed and len(c.calls) == 1 for c in inference.clients)


def test_rejection_is_bounded_and_logs_no_sources_or_credentials(settings, inference, source, caplog):
    inference.reject = True
    with caplog.at_level("INFO", logger="hacksnap"), pytest.raises(EditorialRejected):
        ReviewedSummarizer(settings).summarize(source)
    assert sum(len(c.calls) for c in inference.clients) == 4
    for secret in [settings.llm_api_key, settings.sentiment_api_key, source["article"], settings.llm_base_url]:
        assert secret not in caplog.text
