"""Exercise the production adapter and publication boundary without live writes."""
import asyncio
import copy
import importlib
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from time import monotonic
from types import SimpleNamespace

import pytest
from test_editorial_review import verdict
from test_pipeline import FakeRepository, FakeSummarizer, story

from pipeline.config import EDITORIAL_BATCH_TIMEOUT_SECONDS, Settings
from pipeline.editorial_review import (
    EditorialDeadlineExceeded,
    EditorialReview,
    InferenceOutputError,
)
from pipeline.models import ARTICLE_UNAVAILABLE_NOTICE, CommentSentiment
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
    state = SimpleNamespace(clients=[], reject=False, fail=False,
                            invalid_review=False, invalid_output=False, reviewer_timeout=False)

    class Client:
        def __init__(self, **config):
            self.config, self.calls, self.closed = config, [], False
            state.clients.append(self)

        async def infer(self, role, prompt, payload, schema):
            self.loop = asyncio.get_running_loop()
            self.calls.append({"role": role, "model": self.config["model"]})
            if state.fail:
                raise TimeoutError("inference timeout")
            if role not in {"reviewer", "reviewer_repair"}:
                return draft if schema.__name__ == "GeneratedStorySummary" else draft.discussion_analysis
            if state.invalid_output:
                raise InferenceOutputError("Invalid JSON")
            if state.reviewer_timeout:
                raise TimeoutError("private transport error")
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
            if state.invalid_review:
                review.checks[0].evidence[0].quote = "fabricated quote"
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
    deadlines = []
    generate = ReviewedSummarizer._generate

    async def observed_generate(self, *args):
        deadlines.append(self.deadline)
        return await generate(self, *args)

    monkeypatch.setattr(ReviewedSummarizer, "_generate", observed_generate)
    started = monotonic()
    assert module.run()["generated"] == 1
    assert started + EDITORIAL_BATCH_TIMEOUT_SECONDS <= deadlines[0] <= monotonic() + EDITORIAL_BATCH_TIMEOUT_SECONDS
    assert [call["role"] for c in inference.clients for call in c.calls] == ["writer", "reviewer"]
    assert [c.config["effort"] for c in inference.clients] == ["high", "high"]
    assert all(c.closed for c in inference.clients)
    assert repo.saved[100]["discussion_analysis_metadata"].prompt_version.startswith("reviewed-v1-")
    assert repo.saved[100]["summary"].sentiment == -1


@pytest.mark.parametrize("bullet_length", [451, 650])
def test_fuller_discussion_survives_review_and_storage(
        bullet_length, settings, inference, source, draft):
    draft.discussion_summary.opening = "A" * 300
    draft.discussion_summary.bullets = [letter * bullet_length for letter in "BCDE"]
    repo = FakeRepository([item(source)])
    model = RoutedSummarizer(ReviewedSummarizer(settings), FakeSummarizer())

    assert process_story(item(source), repo,
        SimpleNamespace(fetch=lambda _: source["article"]), model) == "generated"

    expected = draft.discussion_summary.opening + "\n\n" + "\n".join(
        f"- {bullet}" for bullet in draft.discussion_summary.bullets
    )
    assert repo.saved[100]["summary"].discussion_summary == expected
    assert [call["role"] for c in inference.clients for call in c.calls] == ["writer", "reviewer"]


def test_unavailable_article_never_reaches_reviewer_sentiment_or_publication(
        settings, inference, source, draft):
    draft.article_summary = ARTICLE_UNAVAILABLE_NOTICE
    draft.article_key_points = []
    inference.reviewer_timeout = True
    repo = FakeRepository([item(source)])
    sentiment = FakeSummarizer()
    model = RoutedSummarizer(ReviewedSummarizer(settings), sentiment)
    assert process_story(item(source), repo,
        SimpleNamespace(fetch=lambda _: "Javascript is required"), model) == "fetch_skipped"
    assert not repo.saved and repo.failures == {100: item(source)["url"]}
    assert [call["role"] for c in inference.clients for call in c.calls] == ["writer"]
    assert all(c.closed for c in inference.clients)
    assert sentiment.sentiment_calls == 0


@pytest.mark.parametrize("has_notice", [False, True])
def test_self_post_publication_uses_post_text_and_cannot_fail_open_with_notice(
        has_notice, settings, inference, source, draft):
    post_text = source["article"]
    source["article"] = None
    draft.article_summary = None
    draft.article_key_points = []
    if has_notice:
        draft.overall_takeaway = "Source text unavailable. One local test measured 6GB."
    inference.reviewer_timeout = True
    post = item(source)
    post["url"] = "https://news.ycombinator.com/item?id=100"
    payload = json.loads(post["full_raw_text_contents"])
    payload["story"]["text"] = post_text
    post["full_raw_text_contents"] = json.dumps(payload)
    repo = FakeRepository([post])
    model = RoutedSummarizer(ReviewedSummarizer(settings), SimpleNamespace(model="sentiment",
        estimate_sentiment=lambda _: CommentSentiment(sentiment=0)))
    assert process_story(post, repo, None, model) == ("failed" if has_notice else "generated")
    assert not repo.failures  # A bad draft must not permanently exclude a valid HN post.
    assert len(inference.clients[1].calls) == (0 if has_notice else 6)
    assert all(c.closed for c in inference.clients)
    if has_notice:
        assert not repo.saved
    else:
        assert repo.saved[100]["summary"] == draft.to_summary()
        assert repo.saved[100]["coverage"]["article_status"] == "not_applicable"


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


@pytest.mark.parametrize("failure", ["invalid_review", "invalid_output", "reviewer_timeout"])
def test_exhausted_repairs_publish_without_any_public_notice(
        failure, settings, inference, source, draft, caplog):
    repo = FakeRepository([item(source)])
    model = RoutedSummarizer(ReviewedSummarizer(settings), SimpleNamespace(model="sentiment",
        estimate_sentiment=lambda _: CommentSentiment(sentiment=0)))
    setattr(inference, failure, True)
    with caplog.at_level("INFO", logger="hacksnap"):
        assert process_story(item(source), repo,
            SimpleNamespace(fetch=lambda _: source["article"]), model) == "generated"
        assert repo.saved[100]["summary"] == draft.to_summary()
        assert [call["role"] for call in inference.clients[1].calls] == ["reviewer"] + ["reviewer_repair"] * 5
        before = copy.deepcopy(repo.saved[100]["summary"])
        changed = RoutedSummarizer(ReviewedSummarizer(
            replace(settings, sentiment_model="new-reviewer")), model.sentiment)
        assert process_story(item(source), repo, None, changed) == "analysis_updated"
    assert repo.saved[100]["summary"] == before
    assert repo.saved[100]["discussion_analysis"] == draft.discussion_analysis.to_analysis()
    assert len(inference.clients[3].calls) == 6
    assert all(client.closed for client in inference.clients)
    events = [json.loads(record.message) for record in caplog.records
              if record.message.startswith('{"event": "editorial_review_completed"')]
    assert len(events) == 2
    assert all(event["status"] == "unreviewed" and event["fail_open"] for event in events)
    for secret in [source["article"], source["comments"][0]["text"], "fabricated quote",
                   settings.llm_api_key, settings.sentiment_api_key]:
        assert secret not in caplog.text


def test_concurrent_stories_get_separate_clients_and_event_loops(settings, inference, source):
    adapter = ReviewedSummarizer(settings)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(adapter.summarize, [source] * 3))
    assert len(results) == 3 and len(inference.clients) == 6
    assert len({id(c.loop) for c in inference.clients}) == 3
    assert all(c.closed and len(c.calls) == 1 for c in inference.clients)


def test_revision_prompt_change_invalidates_both_versions_and_refresh_cache(
        monkeypatch, settings, inference, source):
    module = importlib.import_module("pipeline.reviewed_summarise")
    repo = FakeRepository([item(source)])
    model = RoutedSummarizer(ReviewedSummarizer(settings), FakeSummarizer())
    assert process_story(item(source), repo, SimpleNamespace(fetch=lambda _: source["article"]), model) == "generated"
    assert process_story(item(source), repo, None, model) == "unchanged"
    original_summary = copy.deepcopy(repo.saved[100]["summary"])
    monkeypatch.setattr(module, "REVISION_PROMPT", module.REVISION_PROMPT + "\nUpdated revision instructions.")
    changed = RoutedSummarizer(ReviewedSummarizer(settings), model.sentiment)
    assert changed.prompt_version != model.prompt_version
    assert changed.discussion_prompt_version != model.discussion_prompt_version
    assert process_story(item(source), repo, None, changed) == "analysis_updated"
    assert len(inference.clients) == 4
    assert repo.saved[100]["summary"] == original_summary
    assert process_story(item(source), repo, None, changed) == "unchanged"
    assert len(inference.clients) == 4


def test_rejection_is_bounded_and_logs_no_sources_or_credentials(settings, inference, source, caplog):
    inference.reject = True
    with caplog.at_level("INFO", logger="hacksnap"), pytest.raises(EditorialRejected):
        ReviewedSummarizer(settings).summarize(source)
    assert sum(len(c.calls) for c in inference.clients) == 4
    assert [c.config["effort"] for c in inference.clients] == ["high", "high"]
    for secret in [settings.llm_api_key, settings.sentiment_api_key, source["article"], settings.llm_base_url]:
        assert secret not in caplog.text


def test_reviewer_timeout_is_separate_from_writer(settings, inference, source):
    configured = replace(settings, llm_timeout=17, reviewer_timeout=321)
    ReviewedSummarizer(configured).summarize(source)
    assert [c.config["timeout"] for c in inference.clients] == [17, 321]
    assert settings.reviewer_timeout == 300


@pytest.mark.parametrize("value", ["0", "-1", "invalid"])
def test_reviewer_timeout_env_rejects_invalid_values(monkeypatch, value):
    for key, content in {"HACKSNAP_DATABASE_URL": "unused",
                         "MODAL_LLM_BASE_URL": "https://writer.invalid/v1",
                         "MODAL_LLM_MODEL": "writer", "MODAL_LLM_API_KEY": "test",
                         "HACKSNAP_REVIEWER_TIMEOUT_SECONDS": value}.items():
        monkeypatch.setenv(key, content)
    with pytest.raises(ValueError):
        Settings.from_env()


def test_reviewer_timeout_env_override(monkeypatch):
    for key, content in {"HACKSNAP_DATABASE_URL": "unused",
                         "MODAL_LLM_BASE_URL": "https://writer.invalid/v1",
                         "MODAL_LLM_MODEL": "writer", "MODAL_LLM_API_KEY": "test",
                         "HACKSNAP_REVIEWER_TIMEOUT_SECONDS": "420"}.items():
        monkeypatch.setenv(key, content)
    assert Settings.from_env().reviewer_timeout == 420
    monkeypatch.delenv("HACKSNAP_REVIEWER_TIMEOUT_SECONDS")
    assert Settings.from_env().reviewer_timeout == 300


@pytest.mark.parametrize("operation", ["summary", "refresh"])
def test_deadline_fallback_stays_internal_and_closes_clients(
        monkeypatch, operation, settings, inference, source, draft, caplog,
        expire_editorial_deadline):
    # Exercise the production adapter with a reviewer whose per-call timeout exceeds the budget.
    configured = replace(settings, reviewer_timeout=10000)
    module = importlib.import_module("pipeline.reviewed_summarise")
    original_client = module.AgentInference
    cancelled = []

    class SlowReviewer(original_client):
        async def infer(self, role, *args):
            if role == "reviewer":
                self.calls.append({"role": role, "model": self.config["model"]})
                try:
                    assert expire_editorial_deadline() <= 60
                    await asyncio.Event().wait()
                finally:
                    cancelled.append(role)
            return await super().infer(role, *args)

    monkeypatch.setattr(module, "AgentInference", SlowReviewer)
    adapter = ReviewedSummarizer(configured, deadline=monotonic() + 60)
    with caplog.at_level("WARNING", logger="hacksnap"):
        result = (adapter.summarize(source) if operation == "summary" else
                  adapter.refresh_discussion(source))
    assert result == (draft.to_summary() if operation == "summary" else
                      draft.discussion_analysis.to_analysis())
    assert cancelled == ["reviewer"]
    assert all(client.closed for client in inference.clients)
    event = json.loads(caplog.records[-1].message)
    assert event["status"] == "unreviewed" and event["fallback_reason"] == "deadline"
    assert event["fail_open"] is True


def test_shared_batch_deadline_does_not_reset_for_later_stories(monkeypatch, settings, inference, source):
    clock = [100.0]
    monkeypatch.setattr("pipeline.editorial_review.monotonic", lambda: clock[0])
    adapter = ReviewedSummarizer(settings, deadline=150)
    adapter.summarize(source)
    clock[0] = 151
    for operation in [adapter.summarize, adapter.refresh_discussion]:
        with pytest.raises(EditorialDeadlineExceeded):
            operation(source)
    assert len(inference.clients) == 6
    assert all(not client.calls for client in inference.clients[2:])
    assert all(client.closed for client in inference.clients)
