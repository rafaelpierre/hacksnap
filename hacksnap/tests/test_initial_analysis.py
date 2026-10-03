"""Initial-generation integration; mocked inference is not a semantic accuracy eval."""
import copy
import json
import logging
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from test_pipeline import (
    FakeRepository,
    FakeSummarizer,
    inference_output,
    many_comments_payload,
    output,
    story,
)

from pipeline.models import DISCUSSION_ANALYSIS_SCHEMA_VERSION
from pipeline.preprocess import sample_sentiment_comments
from pipeline.prompts import EDITORIAL_STYLE_PROMPT, PROMPT_VERSION, SYSTEM_PROMPT
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
        assert body["max_tokens"] == 32000
        assert body["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert EDITORIAL_STYLE_PROMPT in body["messages"][0]["content"]
        assert "discussion_analysis" in body["response_format"]["json_schema"]["schema"]["required"]
        return httpx.Response(200, json={"choices": [{
            "finish_reason": finish_reason,
            "message": {"content": json.dumps(inference_output(result or fixture_output(fixture)))},
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
    assert record["discussion_analysis"].model_dump() == {
        "status": "no_comments" if not fixture["inputs"]["comments"] else "available",
        "reference_claims": [], "critical_comments": [], "supportive_comments": [],
        "topics": fixture["expected"]["topics"],
    }
    metadata = record["discussion_analysis_metadata"]
    assert metadata.schema_version == DISCUSSION_ANALYSIS_SCHEMA_VERSION
    assert metadata.prompt_version == PROMPT_VERSION
    assert metadata.model == "test-model"
    assert metadata.analyzed_at.utcoffset().total_seconds() == 0
    assert metadata.coverage.included_comments == len(fixture["inputs"]["comments"])
    assert len(metadata.source_version) == len(metadata.input_fingerprint) == 64


@pytest.mark.parametrize("mutation", [
    lambda r: r.pop("discussion_analysis"),
    lambda r: r["discussion_analysis"]["topics"][0].update(comment_ids=[999]),
    lambda r: r["discussion_analysis"]["topics"][0].update(key="invented"),
    lambda r: r["discussion_analysis"].update(status="invalid"),
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
    assert record["discussion_analysis"].obj["topics"] == VALID[0]["expected"]["topics"]
    assert record["discussion_analysis"].obj["critical_comments"] == []
    assert record["discussion_analysis"].obj["supportive_comments"] == []
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


def test_editorial_paragraphs_and_bullets_survive_generation_and_storage():
    result = fixture_output(VALID[0])
    result["article_summary"] = (
        "The source reports a performance improvement in its measured workload. "
        "It describes the setup used to obtain that result."
    )
    result["article_key_points"] = [
        "The test uses a fixed workload.",
        "The source identifies its comparison baseline.",
        "The measurements describe the tested hardware.",
        "The implementation details accompany the results.",
    ]
    result["discussion_summary"] = (
        "The central question is how the reported improvement transfers to other workloads."
        "\n\nThe benchmark provides one comparison; production applicability needs its own evidence."
    )
    status, repo = generate(VALID[0], result)
    assert status == "generated"
    stored = repo.saved[100]["summary"]
    for field in ("article_summary", "article_key_points"):
        assert getattr(stored, field) == result[field]
    assert stored.discussion_summary == result["discussion_summary"].replace("\n\n", "\n\n- ")
    assert stored.discussion_analysis.topics[0].title == VALID[0]["expected"]["topics"][0]["title"]
    assert stored.discussion_analysis.critical_comments == []


@pytest.mark.parametrize("brief", [
    {"opening": "Question", "bullets": ["A"] * 5},
    {"opening": "Question", "bullets": ["x" * 451]},
    {"opening": "x" * 301, "bullets": []},
    {"opening": "Question", "bullets": [" "]},
    {"opening": "Question", "bullets": ["First\nSecond"]},
    {"opening": "Question", "bullets": ["First\rSecond"]},
    {"opening": "Question", "bullets": ["First\r\nSecond"]},
    {"opening": "First\nSecond", "bullets": []},
    {"opening": "First\rSecond", "bullets": []},
    {"opening": "First\r\nSecond", "bullets": []},
    {"opening": " ", "bullets": []},
    {"opening": "Question", "bullets": [123]},
    {"opening": "Question"},
])
def test_invalid_discussion_brief_never_saves_partial_summary(brief):
    result = fixture_output(VALID[0])
    result["discussion_summary"] = brief
    status, repo = generate(VALID[0], result)
    assert status == "failed"
    assert repo.saved == {}


def test_comments_require_a_discussion_bullet_before_saving():
    fixture = VALID[0]
    assert fixture["inputs"]["comments"]
    result = fixture_output(fixture)
    assert result["discussion_points"]
    result["discussion_summary"] = {"opening": "The central question.", "bullets": []}
    status, repo = generate(fixture, result)
    assert status == "failed"
    assert repo.saved == {}


@pytest.mark.parametrize("has_comments", [False, True])
def test_discussion_bullet_minimum_depends_on_supplied_comments(has_comments):
    fixture = VALID[0] if has_comments else next(f for f in VALID if f["id"] == "no_comments")
    result = fixture_output(fixture)
    opening = "The central question." if has_comments else "No usable discussion was available."
    bullets = ["The baseline comparison needs clarification."] if has_comments else []
    result["discussion_summary"] = {"opening": opening, "bullets": bullets}
    status, repo = generate(fixture, result)
    assert status == "generated"
    expected = opening + ("\n\n- " + bullets[0] if bullets else "")
    assert repo.saved[100]["summary"].discussion_summary == expected


def test_no_comments_cannot_generate_discussion_bullets():
    fixture = next(f for f in VALID if f["id"] == "no_comments")
    result = fixture_output(fixture)
    result["discussion_summary"] = {"opening": "No usable discussion.", "bullets": ["Invented view."]}
    status, repo = generate(fixture, result)
    assert status == "failed"
    assert repo.saved == {}


def test_brief_schema_requires_separate_opening_and_bullets_but_storage_stays_text():
    from pipeline.models import GeneratedStorySummary, StorySummary

    schema = GeneratedStorySummary.model_json_schema()
    assert set(schema["$defs"]["GeneratedDiscussionAnalysis"]["properties"]) == {
        "status", "topics",
    }
    brief = schema["$defs"]["DiscussionBrief"]
    assert set(brief["required"]) == {"opening", "bullets"}
    assert brief["additionalProperties"] is False
    assert brief["properties"]["bullets"]["maxItems"] == 4
    assert brief["properties"]["bullets"]["items"]["maxLength"] == 450
    assert StorySummary.model_json_schema()["properties"]["discussion_summary"]["type"] == "string"
