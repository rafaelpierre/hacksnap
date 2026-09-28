"""Refresh regressions use retained inputs and mocked inference, never live services."""
import copy
import importlib
import json
from types import SimpleNamespace

import httpx
import pytest
from test_pipeline import FakeRepository, FakeSummarizer, many_comments_payload, story

from pipeline.models import DiscussionAnalysis
from pipeline.preprocess import prepare_comments, sample_sentiment_comments, source_fingerprint
from pipeline.refresh import discussion_source, process_story, refresh
from pipeline.summarise import ModalSummarizer


def setup_story():
    item = {**story(), "content_hash": "a" * 64,
            "full_raw_text_contents": json.dumps(many_comments_payload())}
    repo, model = FakeRepository([item]), FakeSummarizer()
    assert process_story(item, repo, SimpleNamespace(fetch=lambda _: "article"), model) == "generated"
    return item, repo, model


def change_comment(item, *, outside=True):
    payload = json.loads(item["full_raw_text_contents"])
    comments, _ = prepare_comments(payload)
    sampled = {c["id"] for c in sample_sentiment_comments(comments)}
    entry = next(c for c in payload["comments"] if (c["item"]["id"] not in sampled) == outside)
    entry["item"]["text"] += " New qualification."
    item.update(full_raw_text_contents=json.dumps(payload), content_hash="b" * 64)


def test_change_outside_sentiment_sample_refreshes_full_analysis_and_preserves_article():
    item, repo, model = setup_story()
    before = copy.deepcopy(repo.saved[100])
    change_comment(item)
    assert process_story(item, repo, None, model) == "analysis_updated"
    after = repo.saved[100]
    assert len(model.discussion_calls) == 1 and model.sentiment_calls == 0 and model.calls == 1
    assert len(model.discussion_calls[0]["comments"]) > 10
    assert after["summary"] == before["summary"]
    assert after["source_fingerprint"] == before["source_fingerprint"]
    assert after["summarized_content_hash"] == "a" * 64
    assert after["discussion_content_hash"] == "b" * 64
    old, new = before["discussion_analysis_metadata"], after["discussion_analysis_metadata"]
    assert old.source_version == new.source_version
    assert old.input_fingerprint != new.input_fingerprint
    assert old.analyzed_at <= new.analyzed_at
    assert after["discussion_analysis"].reference_claims == before["discussion_analysis"].reference_claims
    assert process_story(item, repo, None, model) == "unchanged"
    assert len(model.discussion_calls) == 1
    assert repo.saved[100]["discussion_analysis_metadata"].analyzed_at == new.analyzed_at


def test_initial_generation_primes_cache_and_raw_only_changes_acknowledge_without_inference():
    item, repo, model = setup_story()
    before = copy.deepcopy(repo.saved[100]["discussion_analysis_metadata"])
    payload = json.loads(item["full_raw_text_contents"])
    payload["comments"].reverse()
    payload["comments"][0]["item"]["text"] += "  "
    item.update(full_raw_text_contents=json.dumps(payload), content_hash="b" * 64)
    assert process_story(item, repo, None, model) == "unchanged"
    assert not model.discussion_calls
    assert repo.saved[100]["discussion_analysis_metadata"] == before
    assert repo.saved[100]["discussion_content_hash"] == "b" * 64


@pytest.mark.parametrize("change", ["model", "prompt", "source_version", "claims", "parent"])
def test_material_input_or_version_change_refreshes(change, monkeypatch):
    item, repo, model = setup_story()
    if change == "model":
        model.model = "new-model"
    elif change == "prompt":
        monkeypatch.setattr(importlib.import_module("pipeline.refresh"),
                            "DISCUSSION_REFRESH_PROMPT_VERSION", "v2-refresh")
    elif change == "source_version":
        repo.saved[100]["discussion_analysis_metadata"].source_version = "c" * 64
    elif change == "claims":
        repo.saved[100]["discussion_analysis"].reference_claims[0].text = "Updated persisted claim"
    else:
        payload = json.loads(item["full_raw_text_contents"])
        payload["comments"][1]["item"]["parent"] = payload["comments"][0]["item"]["id"]
        item["full_raw_text_contents"] = json.dumps(payload)
    assert process_story(item, repo, None, model) == "analysis_updated"
    assert len(model.discussion_calls) == 1 and model.calls == 1


def test_schema_version_is_part_of_fingerprint(monkeypatch):
    item, repo, model = setup_story()
    comments, coverage = prepare_comments(json.loads(item["full_raw_text_contents"]))
    analysis = repo.saved[100]["discussion_analysis"]
    before = discussion_source(comments, coverage, analysis, "a" * 64)
    monkeypatch.setattr(importlib.import_module("pipeline.refresh"), "DISCUSSION_ANALYSIS_SCHEMA_VERSION", "2")
    after = discussion_source(comments, coverage, analysis, "a" * 64)
    assert source_fingerprint(before, model.model, "v1") != source_fingerprint(after, model.model, "v1")


@pytest.mark.parametrize("failure", ["inference", "claim_rewrite", "citation", "persist", "concurrent"])
def test_failure_preserves_last_valid_analysis_and_other_stories_continue(failure):
    item, repo, model = setup_story()
    change_comment(item)
    previous = copy.deepcopy(repo.saved[100])
    repo.stories.append(story(101))
    original = model.refresh_discussion
    def broken(source):
        if failure == "inference":
            raise RuntimeError("failure")
        result = original(source)
        if failure == "claim_rewrite":
            result.reference_claims[0].text = "Invented claim"
        elif failure == "citation":
            result = DiscussionAnalysis.model_validate({**result.model_dump(), "topics": [{
                "key": "evidence", "title": "Evidence", "summary": "An invented citation",
                "comment_ids": [999999],
            }]})
        return result
    model.refresh_discussion = broken
    if failure in {"persist", "concurrent"}:
        def fail_save(*args, **kwargs):
            if failure == "persist":
                raise RuntimeError("database failure")
            return False
        repo.save_discussion_analysis = fail_save
    counts = refresh(repo, SimpleNamespace(fetch=lambda _: "article"), model)
    assert counts["failed"] == 1 and counts["generated"] == 1
    assert repo.saved[100] == previous


def test_absent_retained_source_preserves_new_analysis_without_fetch_or_backfill():
    item, repo, model = setup_story()
    before = copy.deepcopy(repo.saved[100])
    item["full_raw_text_contents"] = None
    assert process_story(item, repo, None, model) == "unavailable"
    assert repo.saved[100] == before and not model.discussion_calls


@pytest.mark.parametrize("claims", [True, False])
@pytest.mark.parametrize("comments", [True, False])
def test_refresh_statuses_use_persisted_claims_and_retained_sample(claims, comments):
    item, repo, model = setup_story()
    if not claims:
        repo.saved[100]["discussion_analysis"] = DiscussionAnalysis(
            status="insufficient_context", reference_claims=[], critical_comments=[],
            supportive_comments=[], topics=[],
        )
    if not comments:
        item["full_raw_text_contents"] = json.dumps({"comments": []})
    model.model = "new-model"
    assert process_story(item, repo, None, model) == "analysis_updated"
    expected = "no_comments" if not comments else "available" if claims else "insufficient_context"
    assert repo.saved[100]["discussion_analysis"].status == expected


@pytest.mark.parametrize("finish_reason", ["stop", "length"])
def test_refresh_endpoint_uses_discussion_only_schema_and_rejects_truncation(finish_reason):
    item, repo, model = setup_story()
    comments, coverage = prepare_comments(json.loads(item["full_raw_text_contents"]))
    source = discussion_source(comments, coverage, repo.saved[100]["discussion_analysis"], "a" * 64)
    result = model.refresh_discussion(source)
    def handler(request):
        body = json.loads(request.content)
        assert body["max_tokens"] == 32000
        assert body["response_format"]["json_schema"]["name"] == "hacksnap_discussion_refresh"
        assert "article_summary" not in body["response_format"]["json_schema"]["schema"]["properties"]
        assert json.loads(body["messages"][1]["content"]) == source
        return httpx.Response(200, json={"choices": [{"finish_reason": finish_reason,
                              "message": {"content": result.model_dump_json()}}]})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        summarizer = ModalSummarizer(client, "https://mock.invalid/v1", "test", "fake")
        if finish_reason == "stop":
            assert summarizer.refresh_discussion(source) == result
        else:
            with pytest.raises(ValueError, match="complete normally"):
                summarizer.refresh_discussion(source)
