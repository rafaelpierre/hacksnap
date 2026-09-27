"""Initial-generation integration; mocked inference is not a semantic accuracy eval."""
import copy
import json
import logging
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from test_pipeline import FakeRepository, FakeSummarizer, many_comments_payload, output, story

from pipeline.models import DISCUSSION_ANALYSIS_SCHEMA_VERSION
from pipeline.preprocess import sample_sentiment_comments
from pipeline.prompts import PROMPT_VERSION
from pipeline.refresh import process_story
from pipeline.summarise import ModalSummarizer

FIXTURES = Path(__file__).parents[1] / "fixtures/discussion-analysis"
VALID = json.loads((FIXTURES / "valid.json").read_text())


def fixture_story(fixture):
    inputs = fixture["inputs"]
    item = story()
    if inputs["article"] is None:
        item["url"] = None
    item["full_raw_text_contents"] = json.dumps({
        "story": {"id": 100, "text": inputs["story_text"]},
        "comments": [{"depth": c["depth"], "item": {
            "id": c["id"], "by": c["author"], "parent": c["parent"], "text": c["text"],
        }} for c in inputs["comments"]],
    })
    return item


def fixture_output(fixture):
    inputs = fixture["inputs"]
    result = output(inputs["article"] is not None)
    result["discussion_analysis"] = copy.deepcopy(fixture["expected"])
    result["discussion_points"] = ([{
        "title": "Discussion", "summary": "A comment discusses the supplied subject.",
        "comment_ids": [inputs["comments"][0]["id"]],
    }] if inputs["comments"] else [])
    result["sentiment"] = 0 if inputs["comments"] else None
    return result


def generate(fixture, result=None, finish_reason="stop", repository=None):
    item = fixture_story(fixture)
    repo = repository or FakeRepository([item])
    def handler(request):
        body = json.loads(request.content)
        assert body["max_tokens"] == 8000
        assert "discussion_analysis" in body["response_format"]["json_schema"]["schema"]["required"]
        return httpx.Response(200, json={"choices": [{
            "finish_reason": finish_reason,
            "message": {"content": json.dumps(result or fixture_output(fixture))},
        }], "usage": {"prompt_tokens": 2100, "completion_tokens": 800, "total_tokens": 2900,
                       "untrusted": "do not log this"}})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = ModalSummarizer(client, "https://mock.invalid/v1", "test-model", "fake")
        status = process_story(item, repo, SimpleNamespace(fetch=lambda _: fixture["inputs"]["article"]), model)
    return status, repo


@pytest.mark.parametrize("fixture", VALID, ids=lambda f: f["id"])
def test_semantic_fixtures_survive_initial_generation(fixture):
    status, repo = generate(fixture)
    assert status == "generated"
    record = repo.saved[100]
    assert record["discussion_analysis"].model_dump() == fixture["expected"]
    metadata = record["discussion_analysis_metadata"]
    assert metadata.schema_version == DISCUSSION_ANALYSIS_SCHEMA_VERSION
    assert metadata.prompt_version == PROMPT_VERSION
    assert metadata.model == "test-model"
    assert metadata.analyzed_at.utcoffset().total_seconds() == 0
    assert metadata.coverage.included_comments == len(fixture["inputs"]["comments"])
    assert len(metadata.source_version) == len(metadata.input_fingerprint) == 64


@pytest.mark.parametrize("mutation", [
    lambda r: r.pop("discussion_analysis"),
    lambda r: r["discussion_analysis"]["critical_comments"][0].update(comment_id=999),
    lambda r: r["discussion_analysis"]["critical_comments"][0].update(claim_id="invented"),
    lambda r: r["discussion_analysis"]["critical_comments"][0].update(stance="agrees"),
    lambda r: r["discussion_analysis"].update(status="no_comments"),
    lambda r: r["discussion_analysis"]["reference_claims"][0].update(source="story_text"),
    lambda r: r["discussion_analysis"].update(extra="untrusted"),
])
def test_invalid_output_never_saves_partial_summary(mutation):
    result = fixture_output(VALID[0])
    mutation(result)
    status, repo = generate(VALID[0], result)
    assert status == "failed"
    assert repo.saved == {}


@pytest.mark.parametrize("reason", ["length", "content_filter", None])
def test_even_valid_json_is_not_saved_when_inference_is_incomplete(reason):
    status, repo = generate(VALID[0], finish_reason=reason)
    assert status == "failed"
    assert not repo.saved


def test_metrics_are_allowlisted_and_include_latency(caplog):
    caplog.set_level(logging.INFO, logger="hacksnap")
    assert generate(VALID[0])[0] == "generated"
    events = [json.loads(r.message) for r in caplog.records]
    metric = next(e for e in events if e.get("event") == "inference_completed")
    assert metric["prompt_tokens"] == 2100
    assert metric["completion_tokens"] == 800
    assert metric["elapsed_seconds"] >= 0
    assert "do not log this" not in caplog.text


def test_legacy_summary_only_refreshes_sentiment():
    item = story()
    repo = FakeRepository([item])
    legacy = {"source_fingerprint": "old", "sentiment": 0, "source_coverage": {}}
    repo.saved[100] = copy.deepcopy(legacy)
    model = FakeSummarizer()
    def unexpected_fetch(_):
        pytest.fail("Existing stories must not refetch articles")
    assert process_story(item, repo, SimpleNamespace(fetch=unexpected_fetch), model) == "sentiment_updated"
    assert model.calls == 0
    assert "discussion_analysis" not in repo.saved[100]
    assert repo.saved[100]["source_fingerprint"] == "old"


def test_full_input_fingerprint_tracks_comments_outside_sentiment_sample():
    item = story()
    data = many_comments_payload()
    item["full_raw_text_contents"] = json.dumps(data)
    from pipeline.preprocess import prepare_comments
    comments, _ = prepare_comments(data)
    sampled = {c["id"] for c in sample_sentiment_comments(comments)}
    excluded = next(c for c in data["comments"] if c["item"]["id"] not in sampled)
    repo = FakeRepository([item])
    fetcher = SimpleNamespace(fetch=lambda _: "article")
    assert process_story(item, repo, fetcher, FakeSummarizer()) == "generated"
    before = repo.saved.pop(100)["discussion_analysis_metadata"]
    excluded["item"]["text"] += " A new qualification."
    item["full_raw_text_contents"] = json.dumps(data)
    assert process_story(item, repo, fetcher, FakeSummarizer()) == "generated"
    after = repo.saved[100]["discussion_analysis_metadata"]
    assert before.source_version == after.source_version
    assert before.input_fingerprint != after.input_fingerprint
    assert after.coverage.included_comments > 10


def test_mutated_nested_model_is_rejected_before_save():
    class Mutated(FakeSummarizer):
        def summarize(self, source):
            summary = super().summarize(source)
            summary.discussion_analysis.status = "bogus"
            return summary
    repo = FakeRepository()
    assert process_story(story(), repo, SimpleNamespace(fetch=lambda _: "article"), Mutated()) == "failed"
    assert not repo.saved


def test_coverage_describes_full_prepared_sample_when_budget_truncates():
    repo = FakeRepository()
    # This budget drops all usable comments; no_comments still records that omission.
    class Empty(FakeSummarizer):
        def summarize(self, source):
            from pipeline.models import StorySummary
            data = output()
            data.update(sentiment=None, discussion_points=[])
            data["discussion_analysis"]["status"] = "no_comments"
            assert source["comments"] == []
            return StorySummary.model_validate(data)
    assert process_story(story(), repo, SimpleNamespace(fetch=lambda _: "article"),
                         Empty(), comment_budget=2) == "generated"
    coverage = repo.saved[100]["discussion_analysis_metadata"].coverage
    assert coverage.stored_comments == 2
    assert coverage.included_comments == 0
    assert coverage.comments_truncated is True


def test_initial_analysis_uses_existing_atomic_repository_write(monkeypatch):
    from unittest.mock import MagicMock

    from pipeline.supabase import Repository
    connection = MagicMock()
    connection.execute.return_value.rowcount = 1
    connect = MagicMock()
    connect.return_value.__enter__.return_value = connection
    repository = Repository("unused")
    monkeypatch.setattr(repository, "_connect", connect)
    monkeypatch.setattr(repository, "get_summary", lambda _: None)
    status, _ = generate(VALID[0], repository=repository)
    assert status == "generated"
    connection.execute.assert_called_once()
    sql, record = connection.execute.call_args.args
    assert "INSERT INTO hacksnap_summaries" in sql
    assert record["discussion_analysis"].obj == VALID[0]["expected"]
    assert record["discussion_analysis_metadata"].obj["analyzed_at"]
    assert record["discussion_analyzed_at"] is not None
    assert record["article_summary"]


def test_analysis_is_saved_before_run_cleanup(monkeypatch):
    import importlib
    module = importlib.import_module("pipeline.refresh")
    from pipeline.config import Settings
    repo = FakeRepository()
    cleaned = []
    def cleanup():
        record = repo.saved[100]
        assert record["discussion_analysis"] is not None
        assert record["discussion_analysis_metadata"].analyzed_at is not None
        cleaned.append(True)
        return {}
    monkeypatch.setattr(repo, "cleanup_contents", cleanup)
    monkeypatch.setattr(module.Settings, "from_env", lambda: Settings(
        database_url="unused", llm_base_url="https://mock.invalid/v1",
        llm_model="test-model", llm_api_key="unused",
    ))
    monkeypatch.setattr(module, "Repository", lambda _: repo)
    monkeypatch.setattr(module, "KestrelFetcher", lambda *args: SimpleNamespace(fetch=lambda _: "article"))
    monkeypatch.setattr(module, "ModalSummarizer", lambda *args: FakeSummarizer())
    assert module.run()["generated"] == 1
    assert cleaned == [True]
