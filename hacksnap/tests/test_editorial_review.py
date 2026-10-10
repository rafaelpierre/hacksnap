import asyncio
import copy

import pytest

from pipeline.editorial_review import (
    EditorialReview,
    prose_fields,
    reviewed_generation,
    validate_draft,
    validate_review,
)
from pipeline.models import GeneratedDiscussionAnalysis, GeneratedStorySummary


@pytest.fixture
def source():
    return {"article": "Probe reports memory use of 5GB. The release is a prototype.",
            "story_text": None, "title": "Probe releases a prototype", "comments": [
                {"id": 10, "depth": 1, "parent": 1, "author": "handle_10", "text": "I measured 6GB in one local test."},
            ]}


@pytest.fixture
def draft():
    return GeneratedStorySummary.model_validate({
        "article_summary": "Probe reports memory use of 5GB.",
        "article_key_points": ["The release is a prototype."],
        "overall_takeaway": "Probe reports 5GB memory use for its prototype.",
        "sentiment": 0,
        "discussion_summary": {"opening": "A local test measured higher memory use.",
                               "bullets": ["One self-reported test measured 6GB."]},
        "discussion_points": [{"title": "One local memory test", "summary":
                               "A self-reported test measured 6GB.", "comment_ids": [10]}],
        "discussion_analysis": {"status": "available", "topics": [
            {"key": "evidence", "title": "One local memory test", "summary":
             "A self-reported test measured 6GB.", "comment_ids": [10]},
        ]},
    })


def verdict(draft, revise=False):
    return EditorialReview.model_validate({
        "decision": "revise" if revise else "accept",
        "checks": [{"path": path, "reasoning": "Supported by the supplied measurement.",
                    "evidence": [{"source": "article", "comment_id": None,
                                  "quote": "Probe reports memory use of 5GB."}]}
                   for path in prose_fields(draft.model_dump())],
        "findings": [{"path": "/overall_takeaway", "kind": "factual",
                      "explanation": "Keep the reported status explicit.",
                      "evidence": [{"source": "article", "comment_id": None,
                                    "quote": "Probe reports memory use of 5GB."}],
                      "correction": "Attribute the measurement to Probe."}] if revise else [],
    })


class FakeInference:
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.calls = []

    async def infer(self, role, prompt, payload, schema):
        self.calls.append((role, prompt, copy.deepcopy(payload), schema))
        value = next(self.outputs)
        if isinstance(value, Exception):
            raise value
        return value


def test_accept_requires_review_of_original_sources(source, draft):
    writer, reviewer = FakeInference([draft]), FakeInference([verdict(draft)])
    result = asyncio.run(reviewed_generation(writer, reviewer, source))
    assert result.status == "accepted"
    assert result.draft == draft.model_dump()
    assert [c[0] for c in writer.calls] == ["writer"]
    assert reviewer.calls[0][2]["sources"]["article"] == source["article"]
    assert reviewer.calls[0][2]["sources"]["comments"] == source["comments"]


def test_one_revision_gets_independent_final_review(source, draft):
    writer = FakeInference([draft, draft])
    reviewer = FakeInference([verdict(draft, True), verdict(draft)])
    result = asyncio.run(reviewed_generation(writer, reviewer, source))
    assert result.status == "accepted" and len(result.history) == 2
    assert [c[0] for c in writer.calls] == ["writer", "revision"]
    assert len(reviewer.calls) == 2
    assert "review" in writer.calls[1][2]


def test_repeated_rejection_stops_without_publishable_draft(source, draft):
    writer = FakeInference([draft, draft])
    reviewer = FakeInference([verdict(draft, True), verdict(draft, True)])
    result = asyncio.run(reviewed_generation(writer, reviewer, source))
    assert result.status == "rejected" and result.draft is None
    assert len(writer.calls) == len(reviewer.calls) == 2
    assert len(result.history) == 2


def test_reviewer_approval_cannot_override_code_checks(source, draft):
    bad = draft.model_copy(update={"overall_takeaway": "The article reports 5GB."})
    writer = FakeInference([bad, bad])
    reviewer = FakeInference([verdict(bad), verdict(bad)])
    result = asyncio.run(reviewed_generation(writer, reviewer, source))
    assert result.status == "rejected" and result.draft is None
    assert result.history[0]["deterministic_findings"]


def test_bad_citation_never_reaches_reviewer(source, draft):
    bad = draft.model_copy(deep=True)
    bad.discussion_points[0].comment_ids = [999]
    reviewer = FakeInference([])
    with pytest.raises(ValueError, match="cites comments"):
        asyncio.run(reviewed_generation(FakeInference([bad]), reviewer, source))
    assert not reviewer.calls


@pytest.mark.parametrize("stage", ["writer", "reviewer", "revision", "final_review"])
def test_stage_failure_never_returns_accepted_result(stage, source, draft):
    failure = TimeoutError("test timeout")
    writer = FakeInference([failure] if stage == "writer" else
                           [draft, failure if stage == "revision" else draft])
    reviewer = FakeInference([failure] if stage == "reviewer" else
                             [verdict(draft, True), failure if stage == "final_review"
                              else verdict(draft)])
    with pytest.raises(TimeoutError):
        asyncio.run(reviewed_generation(writer, reviewer, source))


@pytest.mark.parametrize("mutation,match", [
    (lambda r: r.checks.pop(), "cover every"),
    (lambda r: r.checks.append(r.checks[0]), "duplicate coverage"),
    (lambda r: setattr(r.findings[0], "path", "/unknown"), "unknown field"),
    (lambda r: r.findings[0].evidence.clear(), "no source evidence"),
    (lambda r: setattr(r.findings[0].evidence[0], "quote", "fabricated"), "original source"),
    (lambda r: setattr(r.findings[0].evidence[0], "comment_id", 10), "Non-comment"),
])
def test_invalid_review_cannot_approve_or_direct_repairs(mutation, match, source, draft):
    review = verdict(draft, True)
    mutation(review)
    with pytest.raises(ValueError, match=match):
        validate_review(review, draft.model_dump(), source)


def test_mismatched_quote_and_comment_rejected(source, draft):
    review = verdict(draft, True)
    evidence = review.findings[0].evidence[0]
    evidence.source, evidence.comment_id = "comment", 10
    with pytest.raises(ValueError, match="original source"):
        validate_review(review, draft.model_dump(), source)
    evidence.quote = source["comments"][0]["text"]
    validate_review(review, draft.model_dump(), source)


def test_contradictory_acceptance_rejected(draft):
    review = verdict(draft, True).model_dump()
    review["decision"] = "accept"
    with pytest.raises(ValueError, match="disagrees"):
        EditorialReview.model_validate(review)


def test_refresh_receives_only_comments(source, draft):
    analysis = draft.discussion_analysis
    review = verdict(analysis)
    for check in review.checks:
        check.evidence[0].source = "comment"
        check.evidence[0].comment_id = 10
        check.evidence[0].quote = source["comments"][0]["text"]
    reviewer = FakeInference([review])
    writer = FakeInference([analysis])
    result = asyncio.run(reviewed_generation(writer, reviewer, source, "refresh"))
    assert result.status == "accepted"
    assert set(writer.calls[0][2]) == {"comments"}
    assert set(reviewer.calls[0][2]["sources"]) == {"comments"}


def test_empty_refresh_is_valid_and_reviewed():
    draft = GeneratedDiscussionAnalysis(status="no_comments", topics=[])
    reviewer = FakeInference([verdict(draft)])
    result = asyncio.run(reviewed_generation(FakeInference([draft]), reviewer,
                                            {"comments": []}, "refresh"))
    assert result.status == "accepted" and len(reviewer.calls) == 1


def test_author_names_checked_with_word_boundaries(source, draft):
    bad = draft.model_copy(update={"overall_takeaway": "handle_10 measured 6GB."})
    assert "comment-author" in validate_draft(bad, source, "summary")[0]
    good = draft.model_copy(update={"overall_takeaway": "handle_100 is a separate label."})
    assert not validate_draft(good, source, "summary")


def test_approval_without_positive_evidence_fails(source, draft):
    review = verdict(draft)
    review.checks[0].evidence.clear()
    with pytest.raises(ValueError, match="no source evidence"):
        validate_review(review, draft.model_dump(), source)


def test_null_article_cannot_be_reconstructed_by_writer(source, draft):
    source["article"] = None
    with pytest.raises(ValueError):
        validate_draft(draft, source, "summary")


def test_copying_summary_into_title_is_rejected(source, draft):
    draft.discussion_points[0].title = draft.discussion_points[0].summary
    assert any("title duplicates" in issue for issue in validate_draft(draft, source, "summary"))


def test_rejected_style_field_can_omit_evidence_but_cannot_be_accepted(source, draft):
    review = verdict(draft, True)
    review.findings[0].kind = "style"
    review.findings[0].evidence = []
    check = next(c for c in review.checks if c.path == "/overall_takeaway")
    check.evidence = []
    validate_review(review, draft.model_dump(), source)
    review.findings = []
    review.decision = "accept"
    with pytest.raises(ValueError, match="no source evidence"):
        validate_review(review, draft.model_dump(), source)


def test_revision_cannot_introduce_unknown_citations(source, draft):
    bad = draft.model_copy(deep=True)
    bad.discussion_analysis.topics[0].comment_ids = [999]
    reviewer = FakeInference([verdict(draft, True)])
    with pytest.raises(ValueError):
        asyncio.run(reviewed_generation(FakeInference([draft, bad]), reviewer, source))
    assert len(reviewer.calls) == 1
