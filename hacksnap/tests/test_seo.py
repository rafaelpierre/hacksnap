"""SEO enrichment uses published content and cannot fail publication."""
import json
from copy import deepcopy
from time import monotonic
from unittest.mock import MagicMock

import httpx
import pytest
from pydantic import ValidationError

from pipeline.config import Settings
from pipeline.seo import SearchMetadata, SeoAgent, process_seo, refresh_seo, seo_source


def row():
    return {"story_id": 42, "original_title": "Original headline", "title": "Qualified headline",
            "article_summary": "The authors report a result on a narrow benchmark.",
            "article_key_points": ["Independent validation is absent."],
            "overall_takeaway": "The result remains limited to the reported benchmark.",
            "discussion_points": [], "source_coverage": {"article_status": "fetched"},
            "seo_metadata": None}


def agent():
    instance = MagicMock(model="fixture-model", version="fixture-version")
    instance.generate.return_value = SearchMetadata(
        seo_title="Authors report gains on a narrow benchmark",
        seo_description="The reported gains remain limited to one benchmark, with independent validation still absent.",
    )
    return instance


@pytest.mark.parametrize("copy", ["", "   ", "First\nSecond", "First\tSecond", "<b>text</b>",
                                   "**Bold**", "[Link](url)", "https://example.com", "Clipped…"])
def test_invalid_copy_is_rejected(copy):
    with pytest.raises(ValidationError):
        SearchMetadata(seo_title="A headline", seo_description=copy)


def test_title_target_allows_qualifications_and_description_allows_short_copy():
    result = SearchMetadata(seo_title="A qualified headline " * 5,
                            seo_description="A supported complete sentence.")
    assert len(result.seo_title) > 65
    assert len(result.seo_description) < 140
    with pytest.raises(ValidationError):
        SearchMetadata(seo_title="Headline | Hacksnap", seo_description="A sentence.")


def test_description_limit_rejects_instead_of_clipping():
    description = "A" * 159 + "."
    assert SearchMetadata(seo_title="Headline", seo_description=description).seo_description == description
    with pytest.raises(ValidationError):
        SearchMetadata(seo_title="Headline", seo_description="A" + description)


def test_overlong_model_output_cannot_be_saved_even_if_validation_was_bypassed():
    repository, generator = MagicMock(), agent()
    generator.generate.return_value = SearchMetadata.model_construct(
        seo_title="Headline", seo_description="An overlong sentence. " * 10,
    )
    assert process_seo(row(), repository, generator) == "failed"
    repository.save_seo.assert_not_called()


def test_fingerprint_ignores_routine_refreshes_scores_and_ingestion_age():
    original = row()
    changed = deepcopy(original)
    changed.update(points=500, date_added="2000-01-01", discussion_analysis={"topics": ["New theme"]})
    changed["source_coverage"]["sentiment"] = {"included_comments": 10}
    assert seo_source(original) == seo_source(changed)
    changed["overall_takeaway"] = "Corrected takeaway."
    assert seo_source(original) != seo_source(changed)


def test_generation_persists_only_valid_copy_with_provenance_and_caches_it():
    repository, generator, source = MagicMock(), agent(), row()
    assert process_seo(source, repository, generator) == "generated"
    persisted_row, result, provenance = repository.save_seo.call_args.args
    assert persisted_row == source
    assert provenance["model"] == generator.model
    assert len(provenance["input_fingerprint"]) == 64
    assert result == generator.generate.return_value
    source["seo_metadata"] = provenance
    generator.generate.reset_mock()
    assert process_seo(source, repository, generator) == "unchanged"
    generator.generate.assert_not_called()


def test_failure_leaves_publication_and_prior_metadata_untouched():
    repository, generator = MagicMock(), agent()
    generator.generate.side_effect = RuntimeError("provider failed")
    assert process_seo(row(), repository, generator) == "failed"
    repository.save_seo.assert_not_called()
    repository.save_summary.assert_not_called()


def test_source_correction_during_inference_does_not_publish_stale_results():
    repository, generator = MagicMock(), agent()
    repository.save_seo.return_value = False
    assert process_seo(row(), repository, generator) == "stale"


def test_expired_batch_budget_skips_inference():
    repository, generator = MagicMock(), agent()
    assert process_seo(row(), repository, generator, deadline=monotonic()) == "deferred"
    generator.generate.assert_not_called()


def test_backfill_defaults_to_read_only_without_loading_inference_settings(monkeypatch, capsys):
    from pipeline import backfill_seo

    repository = MagicMock()
    repository.seo_candidates.return_value = [row()]
    monkeypatch.setattr("sys.argv", ["backfill_seo", "--limit", "1", "--after-id", "10"])
    monkeypatch.setattr(backfill_seo, "database_url_from_env", lambda: "unused")
    monkeypatch.setattr(backfill_seo, "SeoRepository", lambda _: repository)
    def forbidden():
        raise AssertionError("Dry run must not require inference settings")
    monkeypatch.setattr(backfill_seo.Settings, "from_env", forbidden)
    backfill_seo.main()
    assert json.loads(capsys.readouterr().out) == {"candidate_ids": [42], "last_id": 42}
    repository.seo_candidates.assert_called_once_with(limit=1, after_id=10)
    repository.save_seo.assert_not_called()


def test_batch_is_bounded_and_uses_automatic_selection_by_default():
    repository, generator = MagicMock(), agent()
    repository.seo_candidates.return_value = [row()]
    assert refresh_seo(repository, generator)["generated"] == 1
    repository.seo_candidates.assert_called_once_with(limit=50, after_id=None)


def test_agent_allows_reasoning_tokens_but_constrains_description_output():
    requests = []
    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={"id": "fixture", "object": "chat.completion",
            "created": 1, "model": "fixture-model", "choices": [{"index": 0,
            "finish_reason": "stop", "message": {"role": "assistant",
            "content": agent().generate.return_value.model_dump_json()}}]})
    settings = Settings(database_url="unused", llm_base_url="https://fixture.invalid/v1",
                        llm_model="fixture-model", llm_api_key="fixture")
    generator = SeoAgent(settings)
    generator.config["transport"] = httpx.MockTransport(respond)
    result = generator.generate(seo_source(row()))
    assert result.seo_title == agent().generate.return_value.seo_title
    assert len(requests) == 1
    assert not requests[0].get("tools")
    assert requests[0].get("max_tokens", requests[0].get("max_completion_tokens")) == 10000
    assert requests[0]["response_format"]["type"] == "json_schema"
    schema = requests[0]["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["seo_description"]["maxLength"] == 160


def test_daily_run_enriches_after_publication_and_isolates_batch_errors(monkeypatch):
    import pipeline.refresh as pipeline
    import pipeline.seo_repository as storage
    from pipeline import seo

    events = []
    settings = Settings(database_url="unused", llm_base_url="https://fixture.invalid/v1",
                        llm_model="fixture-model", llm_api_key="fixture")
    monkeypatch.setattr(pipeline.Settings, "from_env", lambda: settings)
    repository = MagicMock()
    repository.cleanup_contents.return_value = {}
    monkeypatch.setattr(pipeline, "Repository", lambda _: repository)
    monkeypatch.setattr(pipeline, "refresh", lambda *a, **k: events.append("published") or {"generated": 1})
    monkeypatch.setattr(storage, "SeoRepository", lambda _: repository)
    def fail(*args, **kwargs):
        events.append("seo")
        raise RuntimeError("database temporarily unavailable")
    monkeypatch.setattr(seo, "refresh_seo", fail)
    result = pipeline.run()
    assert result["generated"] == 1 and result["seo"] == {"status": "failed"}
    assert events == ["published", "seo"]
    repository.cleanup_contents.assert_called_once()
