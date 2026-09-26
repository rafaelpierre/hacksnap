import copy
import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest

from pipeline.kestrel import FetchError, KestrelFetcher, external_article_url
from pipeline.models import CommentSentiment, StorySummary
from pipeline.preprocess import prepare_comments, source_fingerprint
from pipeline.refresh import process_story, refresh
from pipeline.summarise import ModalSummarizer


def payload():
    return {
        "story": {"id": 100},
        "comments": [
            {
                "depth": 1,
                "item": {
                    "id": 1,
                    "parent": 100,
                    "by": "alice",
                    "text": "<p>The cost is too high.</p>",
                },
            },
            {
                "depth": 2,
                "item": {
                    "id": 2,
                    "parent": 1,
                    "by": "bob",
                    "text": "<p>Batching halves the cost.</p>",
                },
            },
            {"depth": 1, "item": {"id": 3, "parent": 100, "text": "removed", "deleted": True}},
            {"depth": 1, "item": {"id": 4, "parent": 100, "text": "dead", "dead": True}},
            {"depth": 1, "item": {"id": 5, "parent": 100, "text": "<p> </p>"}},
        ],
    }


def story(story_id=100):
    return {
        "hn_id": story_id,
        "title": "AI inference costs",
        "url": "https://example.com/article",
        "full_raw_text_contents": json.dumps(payload()),
    }


def output(article=True):
    return {
        "article_summary": "The article reports lower inference costs." if article else None,
        "article_key_points": ["Batching reduces the cost per token."] if article else [],
        "discussion_summary": "Commenters disagree about the cost of inference.",
        "discussion_points": [
            {
                "title": "Batching changes the comparison",
                "summary": "One commenter argues that batching halves costs.",
                "comment_ids": [1, 2],
            }
        ],
        "sentiment": 0,
        "overall_takeaway": "Cost comparisons depend on batching assumptions.",
    }


class FakeRepository:
    def __init__(self, stories=None):
        self.stories = stories or [story()]
        self.saved = {}
        self.failures = {}
        self.rank_observations = []

    def get_current_top_stories(self, limit):
        return [s for s in self.stories if self.failures.get(s["hn_id"]) != s["url"]][:limit]

    def cleanup_contents(self):
        return {}

    def mark_summarized_contents(self, story_id, fingerprint, content_hash):
        if self.saved[story_id]["source_fingerprint"] == fingerprint:
            self.saved[story_id]["summarized_content_hash"] = content_hash

    def record_rank_history(self):
        self.rank_observations.append([s["hn_id"] for s in self.stories
                                       if self.failures.get(s["hn_id"]) != s["url"]])

    def save_fetch_failure(self, story_id, article_url):
        self.failures[story_id] = article_url

    def get_summary(self, story_id):
        return self.saved.get(story_id)

    def save_sentiment(self, story_id, sentiment, metadata):
        self.saved[story_id]["sentiment"] = sentiment
        self.saved[story_id]["source_coverage"]["sentiment"] = metadata

    def save_summary(self, story_id, article_url, summary, fingerprint, model, version, coverage, content_hash=None):
        self.saved[story_id] = {
            "source_fingerprint": fingerprint,
            "summarized_content_hash": content_hash,
            "summary": summary,
            "sentiment": summary.sentiment,
            "source_coverage": copy.deepcopy(coverage),
            "coverage": coverage,
        }


class FakeSummarizer:
    model = "test-model"

    def __init__(self):
        self.calls = 0
        self.sentiment_calls = 0

    def estimate_sentiment(self, comments):
        self.sentiment_calls += 1
        return CommentSentiment(sentiment=-1)

    def summarize(self, source):
        self.calls += 1
        return StorySummary.model_validate(output(source["article"] is not None))


def test_comments_filter_dead_empty_and_preserve_parent_and_author():
    comments, coverage = prepare_comments(payload())
    assert [c["id"] for c in comments] == [1, 2]
    assert comments[1]["parent"] == 1
    assert comments[0]["author"] == "alice"
    assert comments[0]["text"] == "The cost is too high."
    assert coverage == {"stored_comments": 2, "included_comments": 2, "comments_truncated": False}


def test_budget_is_deterministic_and_keeps_ancestors():
    data = payload()
    original, _ = prepare_comments(data, 130)
    data["comments"].reverse()
    reordered, coverage = prepare_comments(data, 130)
    assert original == reordered
    assert len(json.dumps(original, ensure_ascii=False)) <= 130
    assert [c["id"] for c in original] == [1]
    assert coverage["comments_truncated"]


@pytest.mark.parametrize("change", ["article", "comment", "model", "prompt", "story_text"])
def test_fingerprint_changes_for_every_material_input(change):
    source = {"article": "first", "comments": prepare_comments(payload())[0], "story_text": "post"}
    before = source_fingerprint(source, "m1", "v1")
    modified = copy.deepcopy(source)
    model, prompt = "m1", "v1"
    if change == "article":
        modified["article"] = "second"
    if change == "comment":
        modified["comments"][0]["text"] = "changed"
    if change == "model":
        model = "m2"
    if change == "prompt":
        prompt = "v2"
    if change == "story_text":
        modified["story_text"] = "new post"
    assert source_fingerprint(modified, model, prompt) != before


def test_unchanged_sources_skip_summary_and_sentiment_and_fetch():
    repo, model = FakeRepository(), FakeSummarizer()
    fetches = []
    fetcher = SimpleNamespace(fetch=lambda url: fetches.append(url) or "article")
    assert process_story(story(), repo, fetcher, model) == "generated"
    assert process_story(story(), repo, fetcher, model) == "unchanged"
    assert model.calls == 1
    assert len(fetches) == 1
    assert model.sentiment_calls == 0


def test_failed_sentiment_preserves_existing_summary_and_other_stories_continue():
    repo, model = FakeRepository([story(), story(101)]), FakeSummarizer()
    fetcher = SimpleNamespace(fetch=lambda url: "article")
    process_story(story(), repo, fetcher, model)
    repo.saved[100]["sentiment"] = None
    previous = copy.deepcopy(repo.saved[100])

    class BrokenSentiment(FakeSummarizer):
        def estimate_sentiment(self, comments):
            return {"sentiment": 2}

    counts = refresh(repo, fetcher, BrokenSentiment())
    assert counts["failed"] == 1 and counts["generated"] == 1
    assert repo.saved[100] == previous
    assert 101 in repo.saved


def test_existing_summary_does_not_refetch_article():
    repo, model = FakeRepository(), FakeSummarizer()
    process_story(story(), repo, SimpleNamespace(fetch=lambda url: "article"), model)
    repo.saved[100]["sentiment"] = None
    before = copy.deepcopy(repo.saved[100]["summary"])
    fetcher = SimpleNamespace(fetch=lambda _: pytest.fail("must not refetch"))
    assert process_story(story(), repo, fetcher, model) == "sentiment_updated"
    assert repo.saved[100]["summary"] == before
    assert model.calls == 1 and model.sentiment_calls == 1


def test_new_story_with_failed_article_is_excluded_without_inference():
    repo, model = FakeRepository(), FakeSummarizer()

    def fail(url):
        raise FetchError("Kestrel timed out")

    assert process_story(story(), repo, SimpleNamespace(fetch=fail), model) == "fetch_skipped"
    assert not repo.saved
    assert model.calls == 0
    assert repo.failures == {100: story()["url"]}


def test_fetch_failure_storage_error_still_fails():
    repo = FakeRepository()

    def fail_fetch(url):
        raise FetchError("Kestrel timed out")

    def fail_save(*args):
        raise RuntimeError("storage unavailable")

    repo.save_fetch_failure = fail_save
    counts = refresh(repo, SimpleNamespace(fetch=fail_fetch), FakeSummarizer())
    assert counts["failed"] == 1
    assert counts["fetch_skipped"] == 0


def test_hn_self_post_never_fetches_hn_again():
    item = story()
    item["url"] = "https://news.ycombinator.com/item?id=100"
    repo = FakeRepository()
    assert process_story(item, repo, None, FakeSummarizer()) == "generated"
    assert repo.saved[100]["summary"].article_summary is None
    assert repo.saved[100]["coverage"]["article_status"] == "not_applicable"


def test_rejects_invented_comment_ids_and_article_claims_without_article():
    summary = StorySummary.model_validate(output())
    with pytest.raises(ValueError, match="not supplied"):
        summary.validate_sources("article", [{"id": 1}])
    with pytest.raises(ValueError, match="without an article"):
        summary.validate_sources(None, [{"id": 1}, {"id": 2}])


@pytest.mark.parametrize(
    "url", ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", ""]
)
def test_non_article_urls_are_not_fetched(url):
    assert external_article_url(url) is None


def test_kestrel_uses_verified_cli_and_parses_content(monkeypatch):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"content": "Source: https://example.com\n\nA  useful\narticle"}),
        )

    monkeypatch.setattr(subprocess, "run", run)
    assert KestrelFetcher("kestrel").fetch("https://example.com") == "A useful article"
    assert calls[0][0][:5] == ["kestrel", "fetch", "https://example.com", "--output", "json"]
    assert calls[0][1]["timeout"] == 35


@pytest.mark.parametrize(
    "result",
    [
        SimpleNamespace(returncode=1, stdout=""),
        SimpleNamespace(returncode=0, stdout="bad json"),
        SimpleNamespace(returncode=0, stdout='{"content":" "}'),
    ],
)
def test_kestrel_rejects_bad_responses(monkeypatch, result):
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: result)
    with pytest.raises(FetchError):
        KestrelFetcher("kestrel").fetch("https://example.com")


def test_kestrel_timeout_is_useful_and_source_free(monkeypatch):
    def run(*args, **kwargs):
        raise subprocess.TimeoutExpired("secret-url", 30)

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(FetchError, match="Kestrel timed out"):
        KestrelFetcher("kestrel").fetch("https://example.com")


@pytest.mark.parametrize("finish_reason", ["stop", "length"])
def test_modal_endpoint_requires_complete_structured_response(finish_reason):
    def handler(request):
        request_json = json.loads(request.content)
        assert request_json["response_format"]["json_schema"]["strict"] is True
        assert request_json["model"] == "test-model"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"finish_reason": finish_reason, "message": {"content": json.dumps(output())}}
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake-key")
        source = {"article": "article", "comments": prepare_comments(payload())[0]}
        if finish_reason == "stop":
            assert model.summarize(source).overall_takeaway
        else:
            with pytest.raises(ValueError):
                model.summarize(source)


def test_logs_never_include_arbitrary_exception_content_or_query_secrets(caplog):
    item = story()
    item["url"] += "?api_key=secret-token"

    def fail(url):
        raise RuntimeError("database password secret-password")

    assert (
        process_story(item, FakeRepository(), SimpleNamespace(fetch=fail), FakeSummarizer())
        == "failed"
    )
    assert "secret-token" not in caplog.text
    assert "secret-password" not in caplog.text
    assert '"error_type": "RuntimeError"' in caplog.text


def test_modal_session_affinity_is_shared_within_batch_and_rotates_between_batches():
    sessions = []

    def handler(request):
        sessions.append(request.headers["Modal-Session-Id"])
        assert request.headers["Authorization"] == "Bearer fake-key"
        return httpx.Response(
            200,
            json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(output())}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        for _ in range(2):
            repo = FakeRepository([story(100), story(101)])
            model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake-key")
            counts = refresh(repo, SimpleNamespace(fetch=lambda url: "article"), model)
            assert counts == {"generated": 2, "unchanged": 0, "failed": 0, "fetch_skipped": 0, "unavailable": 0, "sentiment_updated": 0}
            # A cached repeat skips inference regardless of the routing header.
            assert refresh(repo, SimpleNamespace(fetch=lambda url: "article"), model) == {
                "generated": 0, "unchanged": 2, "failed": 0, "fetch_skipped": 0, "unavailable": 0, "sentiment_updated": 0}

    assert len(sessions) == 4
    assert sessions[0] == sessions[1]
    assert sessions[2] == sessions[3]
    assert sessions[0] != sessions[2]


def test_failed_article_is_replaced_in_same_refresh_and_not_retried():
    repo = FakeRepository([story(i) for i in range(12)])
    for item in repo.stories:
        item["url"] = f"https://example.com/{item['hn_id']}"
    calls = []

    def fetch(url):
        calls.append(url)
        if url.endswith(("/0", "/10")):
            raise FetchError("Kestrel exited with code 1")
        return "article"

    fetcher, model = SimpleNamespace(fetch=fetch), FakeSummarizer()
    assert refresh(repo, fetcher, model) == {"generated": 10, "unchanged": 0, "failed": 0, "fetch_skipped": 2, "unavailable": 0, "sentiment_updated": 0}
    assert set(repo.saved) == set(range(1, 10)) | {11}
    calls.clear()
    assert refresh(repo, fetcher, model) == {"generated": 0, "unchanged": 10, "failed": 0, "fetch_skipped": 0, "unavailable": 0, "sentiment_updated": 0}
    assert not any(url.endswith(("/0", "/10")) for url in calls)
    repo.stories[0]["url"] = "https://example.com/corrected"
    assert refresh(repo, fetcher, model)["generated"] == 1


def test_all_fetches_fail_without_looping_forever():
    repo = FakeRepository([story(i) for i in range(60)])

    def fail(url):
        raise FetchError("Kestrel timed out")

    counts = refresh(repo, SimpleNamespace(fetch=fail), FakeSummarizer())
    assert counts == {"generated": 0, "unchanged": 0, "failed": 0, "fetch_skipped": 50, "unavailable": 0, "sentiment_updated": 0}
    assert len(repo.failures) == 50


def test_missing_kestrel_does_not_permanently_exclude_articles(monkeypatch):
    def missing(*args, **kwargs):
        raise FileNotFoundError("missing executable")

    monkeypatch.setattr(subprocess, "run", missing)
    repo = FakeRepository()
    assert refresh(repo, KestrelFetcher("missing"), FakeSummarizer())["failed"] == 1
    assert not repo.failures


@pytest.mark.parametrize("outcome", ["generated", "inference_failure", "fetch_skipped"])
def test_run_returns_isolated_story_failures_with_cache_hits(monkeypatch, caplog, outcome):
    import importlib
    module = importlib.import_module("pipeline.refresh")
    repo = FakeRepository([story(), story(101)])
    fetcher = SimpleNamespace(fetch=lambda url: "article")
    model = FakeSummarizer()
    process_story(story(), repo, fetcher, model)

    if outcome == "fetch_skipped":
        def fail_fetch(url):
            raise FetchError("Kestrel timed out")
        fetcher = SimpleNamespace(fetch=fail_fetch)

    class RateLimited(FakeSummarizer):
        def summarize(self, source):
            response = httpx.Response(429, request=httpx.Request("POST", "https://example.com"))
            response.raise_for_status()

    monkeypatch.setattr(module.Settings, "from_env", lambda: SimpleNamespace(
        database_url="unused", kestrel_binary="unused", fetch_timeout=1,
        article_chars=100, llm_timeout=1, llm_base_url="https://example.com",
        llm_model=model.model, llm_api_key="unused", llm_reasoning_effort="low",
        comment_chars=48000,
    ))
    monkeypatch.setattr(module, "Repository", lambda _: repo)
    monkeypatch.setattr(module, "KestrelFetcher", lambda *args: fetcher)
    monkeypatch.setattr(module, "ModalSummarizer", lambda *args: RateLimited() if outcome == "inference_failure" else model)
    if outcome == "inference_failure":
        counts = module.run()
        assert counts["failed"] == 1
        assert counts["generated"] == 0
        assert counts["unchanged"] == 1
        assert 100 in repo.saved
        assert 101 not in repo.saved
    elif outcome == "fetch_skipped":
        with caplog.at_level("INFO", logger="hacksnap"):
            counts = module.run()
        assert counts["failed"] == 0
        assert counts["fetch_skipped"] == 1
        assert counts["unchanged"] == 1
        events = [json.loads(record.message) for record in caplog.records]
        completed = next(event for event in events if event.get("event") == "refresh_completed")
        assert completed["status"] == "succeeded"
        assert repo.failures == {101: story(101)["url"]}
    else:
        assert module.run() == {"generated": 1, "unchanged": 1, "failed": 0, "fetch_skipped": 0, "unavailable": 0, "sentiment_updated": 0}


def test_refresh_records_all_ranks_after_fetch_failures_even_when_unchanged():
    repo = FakeRepository([story(i) for i in range(100, 112)])

    def fetch(url):
        if url == repo.stories[0]["url"]:
            raise FetchError("unavailable")
        return "article"

    # Give each story its own URL so only the first one is excluded.
    for item in repo.stories:
        item["url"] = f"https://example.com/{item['hn_id']}"
    model = FakeSummarizer()
    counts = refresh(repo, SimpleNamespace(fetch=fetch), model)
    assert counts["failed"] == 0
    assert counts["fetch_skipped"] == 1
    assert repo.rank_observations == [list(range(101, 112))]
    assert 111 not in repo.saved  # Below the ten-story inference/display cutoff.
    counts = refresh(repo, SimpleNamespace(fetch=fetch), model)
    assert counts["unchanged"] == 10
    assert repo.rank_observations == [list(range(101, 112))] * 2


def test_rank_recording_failure_is_not_reported_as_success():
    repo = FakeRepository()

    def fail():
        raise RuntimeError("rank storage failed")

    repo.record_rank_history = fail
    with pytest.raises(RuntimeError, match="rank storage failed"):
        refresh(repo, SimpleNamespace(fetch=lambda url: "article"), FakeSummarizer())


def test_missing_contents_skips_inference_and_reports_unavailable():
    item = story()
    item["full_raw_text_contents"] = None
    repo, model = FakeRepository([item]), FakeSummarizer()
    fetcher = SimpleNamespace(fetch=lambda _: pytest.fail("must not fetch without comments"))
    assert process_story(item, repo, fetcher, model) == "unavailable"
    repo.saved[100] = {"source_fingerprint": "old"}
    assert process_story(item, repo, fetcher, model) == "unavailable"
    assert model.calls == 0


def test_changed_comments_refresh_sentiment_without_advancing_summary_hash():
    item = story()
    item["content_hash"] = "a" * 64
    repo, model = FakeRepository([item]), FakeSummarizer()
    fetcher = SimpleNamespace(fetch=lambda _: "article")
    assert process_story(item, repo, fetcher, model) == "generated"
    previous = copy.deepcopy(repo.saved[100])
    changed = payload()
    changed["comments"][0]["item"]["text"] = "Changed argument"
    item["full_raw_text_contents"] = json.dumps(changed)
    item["content_hash"] = "b" * 64
    assert process_story(item, repo, fetcher, model) == "sentiment_updated"
    assert repo.saved[100]["summarized_content_hash"] == "a" * 64
    assert repo.saved[100]["summary"] == previous["summary"]
    assert repo.saved[100]["sentiment"] == -1
    assert process_story(item, repo, fetcher, model) == "unchanged"
    assert model.calls == 1 and model.sentiment_calls == 1


@pytest.mark.parametrize("sentiment", [-1, 0, 1])
def test_sentiment_accepts_only_scale_integers(sentiment):
    result = StorySummary.model_validate({**output(), "sentiment": sentiment})
    result.validate_sources("article", [{"id": 1}, {"id": 2}])
    assert result.sentiment == sentiment


@pytest.mark.parametrize("sentiment", [-2, 2, 0.5, "1", True, False])
def test_sentiment_rejects_invalid_scores(sentiment):
    with pytest.raises(ValueError):
        StorySummary.model_validate({**output(), "sentiment": sentiment})


def test_sentiment_requires_comments_and_cannot_be_omitted():
    with pytest.raises(ValueError):
        StorySummary.model_validate({k: v for k, v in output().items() if k != "sentiment"})
    result = StorySummary.model_validate({**output(), "sentiment": None, "discussion_points": []})
    result.validate_sources("article", [])
    with pytest.raises(ValueError, match="omits discussion sentiment"):
        result.validate_sources("article", [{"id": 1}])
    result.sentiment = 0
    with pytest.raises(ValueError, match="requires supplied comments"):
        result.validate_sources("article", [])


def test_existing_summary_survives_prompt_and_model_changes():
    item = story()
    repo, model = FakeRepository([item]), FakeSummarizer()
    fetcher = SimpleNamespace(fetch=lambda _: "article")
    assert process_story(item, repo, fetcher, model, prompt_version="v1") == "generated"
    model.model = "another-model"
    item["title"] = "Changed title"
    assert process_story(item, repo, fetcher, model) == "unchanged"
    assert model.calls == 1 and model.sentiment_calls == 0


def test_missing_sentiment_is_backfilled_even_with_matching_comment_fingerprint():
    repo, model = FakeRepository(), FakeSummarizer()
    process_story(story(), repo, SimpleNamespace(fetch=lambda _: "article"), model)
    repo.saved[100]["sentiment"] = None
    assert process_story(story(), repo, None, model) == "sentiment_updated"
    assert process_story(story(), repo, None, model) == "unchanged"
    assert model.sentiment_calls == 1


def test_scored_legacy_row_adopts_comment_cache_without_inference():
    item = {**story(), "content_hash": "retained-hash"}
    repo, model = FakeRepository(), FakeSummarizer()
    process_story(item, repo, SimpleNamespace(fetch=lambda _: "article"), model)
    del repo.saved[100]["source_coverage"]["sentiment"]
    assert process_story(item, repo, None, model) == "unchanged"
    assert process_story(item, repo, None, model) == "unchanged"
    assert model.sentiment_calls == 0
    assert repo.saved[100]["sentiment"] == 0


def test_empty_comments_clear_score_without_inference_and_are_cached():
    repo, model = FakeRepository(), FakeSummarizer()
    process_story(story(), repo, SimpleNamespace(fetch=lambda _: "article"), model)
    item = {**story(), "full_raw_text_contents": json.dumps({"comments": []})}
    assert process_story(item, repo, None, model) == "sentiment_updated"
    assert repo.saved[100]["sentiment"] is None
    assert process_story(item, repo, None, model) == "unchanged"
    assert model.sentiment_calls == 0


def test_sentiment_backfill_only_processes_top_ten():
    repo, model = FakeRepository([story(i) for i in range(11)]), FakeSummarizer()
    for item in repo.stories:
        process_story(item, repo, SimpleNamespace(fetch=lambda _: "article"), model)
        repo.saved[item["hn_id"]]["sentiment"] = None
    assert refresh(repo, None, model)["sentiment_updated"] == 10
    assert model.sentiment_calls == 10
    assert repo.saved[10]["sentiment"] is None


@pytest.mark.parametrize("score", [-1, 0, 1, None, 2, True, "1"])
def test_sentiment_endpoint_receives_only_comments_and_validates_score(score):
    comments = prepare_comments(payload())[0]
    def handler(request):
        body = json.loads(request.content)
        assert json.loads(body["messages"][1]["content"]) == {"comments": comments}
        assert body["response_format"]["json_schema"]["name"] == "hacksnap_sentiment"
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": json.dumps({"sentiment": score})}
        }]})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake-key")
        if type(score) is int and -1 <= score <= 1:
            assert model.estimate_sentiment(comments).sentiment == score
        else:
            with pytest.raises(ValueError):
                model.estimate_sentiment(comments)


def many_comments_payload():
    return {"comments": [
        {"depth": 1, "item": {"id": i, "parent": 100, "by": f"user{i}", "text": f"Opinion {i}"}}
        for i in range(1, 31)
    ]}


def test_sentiment_sample_is_capped_stable_and_handles_small_discussions():
    from pipeline.preprocess import sample_sentiment_comments
    comments = prepare_comments(many_comments_payload())[0]
    sample = sample_sentiment_comments(comments)
    assert len(sample) == 10
    assert sample == sample_sentiment_comments(list(reversed(comments)))
    assert sample_sentiment_comments([]) == []
    assert sample_sentiment_comments(comments[:4]) == comments[:4]


def test_sentiment_cache_tracks_only_the_ten_comment_sample():
    from pipeline.preprocess import sample_sentiment_comments
    data = many_comments_payload()
    item = {**story(), "full_raw_text_contents": json.dumps(data)}
    repo, model = FakeRepository(), FakeSummarizer()
    assert process_story(item, repo, SimpleNamespace(fetch=lambda _: "article"), model) == "generated"
    metadata = repo.saved[100]["source_coverage"]["sentiment"]
    assert metadata["included_comments"] == 10
    assert metadata["comments_truncated"] is True
    sampled_ids = {c["id"] for c in sample_sentiment_comments(prepare_comments(data)[0])}
    outside = next(c for c in data["comments"] if c["item"]["id"] not in sampled_ids)
    outside["item"]["text"] = "Changed outside the sample"
    item["full_raw_text_contents"] = json.dumps(data)
    assert process_story(item, repo, None, model) == "unchanged"
    inside = next(c for c in data["comments"] if c["item"]["id"] in sampled_ids)
    inside["item"]["text"] = "Changed inside the sample"
    item["full_raw_text_contents"] = json.dumps(data)
    assert process_story(item, repo, None, model) == "sentiment_updated"
    assert model.calls == 1 and model.sentiment_calls == 1


def test_both_endpoint_paths_use_ten_sentiment_comments_and_preserve_summary_input():
    comments = prepare_comments(many_comments_payload())[0]
    requests = []
    def handler(request):
        body = json.loads(request.content)
        source = json.loads(body["messages"][1]["content"])
        requests.append(source)
        if body["response_format"]["json_schema"]["name"] == "hacksnap_summary":
            assert len(source["comments"]) == 30
            assert len(source["sentiment_comments"]) == 10
            result = output()
        else:
            assert len(source["comments"]) == 10
            result = {"sentiment": 0}
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": json.dumps(result)}
        }]})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://test.modal.run/v1", "test-model", "fake-key")
        model.summarize({"article": "article", "comments": comments})
        model.estimate_sentiment(comments)
    assert requests[0]["sentiment_comments"] == requests[1]["comments"]


def test_takeaway_schema_bounds_new_decks_without_truncating_claims():
    from pydantic import ValidationError

    result = output()
    result["overall_takeaway"] = "x" * 220
    assert StorySummary.model_validate(result).overall_takeaway == "x" * 220
    result["overall_takeaway"] += "x"
    with pytest.raises(ValidationError, match="overall_takeaway"):
        StorySummary.model_validate(result)
