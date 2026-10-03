"""The release evaluator must not mistake structural success for semantic approval."""
import copy
import json

from test_initial_analysis import fixture_output

from pipeline.evaluate_discussion import FIXTURES, evaluate_case
from pipeline.models import DiscussionAnalysis, StorySummary


def test_evaluator_retains_real_output_and_leaves_semantic_review_pending():
    fixture = json.loads(FIXTURES.read_text())[0]

    class Model:
        def summarize(self, source):
            assert "expected" not in source
            assert source["title"] == "Engine performance discussion"
            return StorySummary.model_validate(fixture_output(fixture))

        def refresh_discussion(self, source):
            assert "reference_claims" not in source
            return DiscussionAnalysis.model_validate(fixture["expected"])

    for mode in ("initial", "refresh"):
        result = evaluate_case(fixture, mode, Model())
        assert result["validation"] == "passed"
        assert result["semantic_review"] == "pending"
        assert result["output_characters"] > 0
        assert result["semantic_expectations"] == fixture["semantic_expectations"]


def test_failed_case_is_sanitized_and_does_not_prevent_following_case():
    fixtures = json.loads(FIXTURES.read_text())

    class Model:
        def summarize(self, source):
            if source["comments"] == fixtures[0]["inputs"]["comments"]:
                raise ValueError("private provider response and credentials")
            return StorySummary.model_validate(fixture_output(fixtures[1]))

    before = copy.deepcopy(fixtures)
    failed = evaluate_case(fixtures[0], "initial", Model())
    passed = evaluate_case(fixtures[1], "initial", Model())
    assert failed["validation"] == "failed"
    assert failed["error_type"] == "ValueError"
    assert "private" not in json.dumps(failed)
    assert passed["validation"] == "passed"
    assert fixtures == before
