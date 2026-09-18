import copy
import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest

from pipeline.kestrel import FetchError, KestrelFetcher, external_article_url
from pipeline.models import StorySummary
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
        "overall_takeaway": "Cost comparisons depend on batching assumptions.",
    }


class FakeRepository:
    def __init__(self, stories=None):
        self.stories = stories or [story()]
        self.saved = {}

    def get_current_top_stories(self, limit):
        return self.stories[:limit]

    def get_summary(self, story_id):
        return self.saved.get(story_id)

    def save_summary(self, story_id, article_url, summary, fingerprint, model, version, coverage):
        self.saved[story_id] = {
            "source_fingerprint": fingerprint,
            "summary": summary,
            "coverage": coverage,
        }


class FakeSummarizer:
    model = "test-model"

    def __init__(self):
        self.calls = 0

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


def test_unchanged_sources_skip_inference_but_article_is_refetched():
    repo, model = FakeRepository(), FakeSummarizer()
    fetches = []
    fetcher = SimpleNamespace(fetch=lambda url: fetches.append(url) or "article")
    assert process_story(story(), repo, fetcher, model) == "generated"
    assert process_story(story(), repo, fetcher, model) == "unchanged"
    assert model.calls == 1
    assert len(fetches) == 2


def test_malformed_output_preserves_existing_summary_and_other_stories_continue():
    repo, model = FakeRepository([story(), story(101)]), FakeSummarizer()
    fetcher = SimpleNamespace(fetch=lambda url: "article")
    assert process_story(story(), repo, fetcher, model) == "generated"
    previous = copy.deepcopy(repo.saved[100])

    class BrokenOnce(FakeSummarizer):
        model = "changed-model"  # force regeneration

        def summarize(self, source):
            self.calls += 1
            if self.calls == 1:
                return {"not": "a summary"}
            return StorySummary.model_validate(output())

    counts = refresh(repo, fetcher, BrokenOnce())
    assert counts == {"failed": 1, "generated": 1, "unchanged": 0}
    assert repo.saved[100] == previous
    assert 101 in repo.saved


def test_fetch_failure_does_not_replace_valid_summary():
    repo, model = FakeRepository(), FakeSummarizer()
    process_story(story(), repo, SimpleNamespace(fetch=lambda url: "article"), model)
    before = copy.deepcopy(repo.saved)

    def fail(url):
        raise FetchError("Kestrel timed out")

    assert process_story(story(), repo, SimpleNamespace(fetch=fail), model) == "failed"
    assert repo.saved == before
    assert model.calls == 1


def test_new_story_with_failed_article_can_have_discussion_only_summary():
    repo, model = FakeRepository(), FakeSummarizer()

    def fail(url):
        raise FetchError("Kestrel timed out")

    assert process_story(story(), repo, SimpleNamespace(fetch=fail), model) == "generated"
    assert repo.saved[100]["summary"].article_summary is None
    assert repo.saved[100]["coverage"]["article_status"] == "unavailable"


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
