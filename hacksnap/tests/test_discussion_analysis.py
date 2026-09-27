"""Contract tests run without inference, network access, or a database."""

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline.models import (
    DISCUSSION_ANALYSIS_SCHEMA_VERSION,
    DiscussionAnalysis,
    DiscussionAnalysisCoverage,
    DiscussionAnalysisMetadata,
    StorySummary,
)

FIXTURES = Path(__file__).parents[1] / "fixtures" / "discussion-analysis"
VALID = json.loads((FIXTURES / "valid.json").read_text())
INVALID = json.loads((FIXTURES / "invalid.json").read_text())
METADATA = json.loads((FIXTURES / "metadata.json").read_text())


@pytest.mark.parametrize("case", VALID, ids=lambda case: case["id"])
def test_valid_shared_fixtures(case):
    result = DiscussionAnalysis.model_validate(case["expected"])
    result.validate_sources(**case["inputs"])
    assert result.model_dump(mode="json") == case["expected"]
    assert case["semantic_expectations"]


@pytest.mark.parametrize("case", INVALID, ids=lambda case: case["id"])
def test_invalid_shared_fixtures(case):
    with pytest.raises(ValueError, match=case["expected_error"]):
        result = DiscussionAnalysis.model_validate(case["expected"])
        result.validate_sources(**case["inputs"])


@pytest.mark.parametrize("invalid_id", [True, 0, -1, "101", 101.5])
def test_comment_ids_are_strict_positive_integers(invalid_id):
    data = copy.deepcopy(VALID[0]["expected"])
    data["critical_comments"][0]["comment_id"] = invalid_id
    with pytest.raises(ValidationError):
        DiscussionAnalysis.model_validate(data)


@pytest.mark.parametrize("field", ["reference_claims", "critical_comments", "topics"])
def test_output_limits(field):
    data = copy.deepcopy(VALID[0]["expected"])
    limit = 3 if field == "critical_comments" else 6
    data[field] *= limit + 1
    with pytest.raises(ValidationError, match="at most"):
        DiscussionAnalysis.model_validate(data)


def test_supportive_limit():
    data = copy.deepcopy(VALID[1]["expected"])
    data["supportive_comments"] *= 4
    with pytest.raises(ValidationError, match="at most"):
        DiscussionAnalysis.model_validate(data)


def test_duplicate_highlights_across_sides_rejected():
    data = copy.deepcopy(VALID[0]["expected"])
    data["supportive_comments"] = [{**data["critical_comments"][0], "stance": "agrees"}]
    with pytest.raises(ValidationError, match="duplicate highlights"):
        DiscussionAnalysis.model_validate(data)


@pytest.mark.parametrize("stance", ["mixed", "unclear", "agrees", "qualified_agreement"])
def test_critical_list_rejects_other_stances(stance):
    data = copy.deepcopy(VALID[0]["expected"])
    data["critical_comments"][0]["stance"] = stance
    with pytest.raises(ValidationError):
        DiscussionAnalysis.model_validate(data)


@pytest.mark.parametrize("stance", ["mixed", "unclear", "disagrees", "qualified_disagreement"])
def test_supportive_list_rejects_other_stances(stance):
    data = copy.deepcopy(VALID[1]["expected"])
    data["supportive_comments"][0]["stance"] = stance
    with pytest.raises(ValidationError):
        DiscussionAnalysis.model_validate(data)


@pytest.mark.parametrize("value", [" ", "x" * 601])
def test_highlight_text_is_nonempty_and_bounded(value):
    data = copy.deepcopy(VALID[0]["expected"])
    data["critical_comments"][0]["paraphrase"] = value
    with pytest.raises(ValidationError):
        DiscussionAnalysis.model_validate(data)


def test_unrecognized_topic_and_extra_fields_rejected():
    data = copy.deepcopy(VALID[0]["expected"])
    data["topics"][0]["key"] = "community_consensus"
    with pytest.raises(ValidationError):
        DiscussionAnalysis.model_validate(data)
    data = copy.deepcopy(VALID[0]["expected"])
    data["critical_comments"][0]["confidence"] = 0.99
    with pytest.raises(ValidationError, match="Extra inputs"):
        DiscussionAnalysis.model_validate(data)


def test_metadata_json_round_trip_and_source_count_validation():
    metadata = DiscussionAnalysisMetadata.model_validate_json(json.dumps(METADATA))
    result = DiscussionAnalysis.model_validate(VALID[0]["expected"])
    metadata.validate_analysis(result, VALID[0]["inputs"]["comments"])
    assert metadata.model_dump(mode="json") == METADATA
    assert metadata.schema_version == DISCUSSION_ANALYSIS_SCHEMA_VERSION
    with pytest.raises(ValueError, match="Coverage disagrees"):
        metadata.validate_analysis(result, [])
    with pytest.raises(ValueError, match="status disagrees"):
        metadata.validate_analysis(
            DiscussionAnalysis.model_validate(next(c["expected"] for c in VALID
                                                   if c["id"] == "no_comments")),
            VALID[0]["inputs"]["comments"],
        )


@pytest.mark.parametrize("change", [
    {"included_comments": 4}, {"stored_comments": -1}, {"included_comments": True},
    {"comments_truncated": False}, {"selection_method": "random"},
])
def test_invalid_coverage(change):
    with pytest.raises(ValidationError):
        DiscussionAnalysisCoverage.model_validate({**METADATA["coverage"], **change})


@pytest.mark.parametrize("change", [
    {"schema_version": "2"}, {"schema_version": 1}, {"input_fingerprint": "unknown"},
    {"source_version": ""}, {"prompt_version": " "}, {"model": " "},
    {"analyzed_at": "2026-09-27T12:00:00"},
])
def test_invalid_provenance(change):
    with pytest.raises(ValidationError):
        DiscussionAnalysisMetadata.model_validate_json(json.dumps({**METADATA, **change}))


def test_schema_artifacts_match_models_and_all_object_fields_are_required():
    for name, model in [("analysis.schema.json", DiscussionAnalysis),
                        ("metadata.schema.json", DiscussionAnalysisMetadata)]:
        schema = model.model_json_schema()
        assert json.loads((FIXTURES / name).read_text()) == schema
        for definition in [schema, *schema.get("$defs", {}).values()]:
            if definition.get("type") == "object":
                assert definition["additionalProperties"] is False
                assert set(definition["required"]) == set(definition["properties"])


def test_existing_summary_contract_is_unchanged():
    assert "discussion_analysis" not in StorySummary.model_fields
