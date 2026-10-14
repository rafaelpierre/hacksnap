import asyncio
import copy

import pytest

from pipeline.editorial_review import (
    EditorialReview,
    Evidence,
    prose_fields,
    reviewed_generation,
    validate_draft,
    validate_review,
)
from pipeline.models import (
    ARTICLE_UNAVAILABLE_NOTICE,
    GeneratedDiscussionAnalysis,
    GeneratedStorySummary,
)


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


@pytest.mark.parametrize("author", ["it", "one", "test", "memory", "Probe"])
def test_ordinary_word_handles_do_not_block_valid_prose(author, source, draft):
    source["comments"][0]["author"] = author
    draft.discussion_summary.opening = "One local test measured memory use; it reached 6GB, according to one test."
    writer, reviewer = FakeInference([draft]), FakeInference([verdict(draft)])
    result = asyncio.run(reviewed_generation(writer, reviewer, source))
    assert result.status == "accepted"
    assert len(writer.calls) == 1


@pytest.mark.parametrize("text", ["@test measured 6GB.", "Username test reported 6GB.",
                                  "User test measured 6GB."])
def test_explicit_attribution_of_word_handles_is_rejected(text, source, draft):
    source["comments"][0]["author"] = "test"
    draft.overall_takeaway = text
    assert any("comment-author" in issue for issue in validate_draft(draft, source, "summary"))


@pytest.mark.parametrize("opening", ["A major release arrived", "No additional analysis available."])
def test_no_comments_opening_enforced_before_review(opening, source, draft):
    source["comments"] = []
    draft.sentiment = None
    draft.discussion_points = []
    draft.discussion_analysis = GeneratedDiscussionAnalysis(status="no_comments", topics=[])
    draft.discussion_summary.opening = opening
    draft.discussion_summary.bullets = []
    writer, reviewer = FakeInference([draft]), FakeInference([verdict(draft)])
    if opening == "No additional analysis available.":
        assert asyncio.run(reviewed_generation(writer, reviewer, source)).status == "accepted"
    else:
        with pytest.raises(ValueError, match="empty-state opening"):
            asyncio.run(reviewed_generation(writer, reviewer, source))
        assert not reviewer.calls


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


@pytest.fixture
def unavailable_draft(source, draft):
    source["comments"] = []
    draft.article_summary = ARTICLE_UNAVAILABLE_NOTICE
    draft.article_key_points = []
    draft.overall_takeaway = "Source text unavailable."
    draft.sentiment = None
    draft.discussion_points = []
    draft.discussion_analysis = GeneratedDiscussionAnalysis(status="no_comments", topics=[])
    draft.discussion_summary.opening = "No additional analysis available."
    draft.discussion_summary.bullets = []
    return draft


def test_unavailable_article_claim_cannot_escape_review(source, unavailable_draft):
    review = verdict(unavailable_draft)
    review.checks = [check for check in review.checks if check.path != "/article_summary"]
    for check in review.checks:
        check.evidence = []
    with pytest.raises(ValueError, match="cover every"):
        asyncio.run(reviewed_generation(FakeInference([unavailable_draft]),
                                        FakeInference([review, review]), source))


def test_unavailable_article_claim_requires_page_evidence(source, unavailable_draft):
    review = verdict(unavailable_draft)
    check = next(check for check in review.checks if check.path == "/article_summary")
    check.evidence = []
    with pytest.raises(ValueError, match="evidence from the retrieved page"):
        validate_review(review, unavailable_draft.model_dump(), source)


def test_reviewer_can_reject_discarded_usable_article(source, unavailable_draft):
    review = verdict(unavailable_draft, revise=True)
    review.findings[0].path = "/article_summary"
    review.findings[0].explanation = "The supplied page contains a usable prototype announcement."
    review.findings[0].correction = "Summarize the announcement instead of marking it unavailable."
    reviewer = FakeInference([review, review])
    result = asyncio.run(reviewed_generation(
        FakeInference([unavailable_draft, unavailable_draft]), reviewer, source))
    assert result.status == "rejected" and result.draft is None
    assert "/article_summary" in reviewer.calls[0][2]["prose_fields"]


def test_genuinely_unusable_page_can_be_accepted_after_evidence_review(source, unavailable_draft):
    source["article"] = "Access denied. Please sign in to continue."
    review = verdict(unavailable_draft)
    for check in review.checks:
        check.evidence = []
        if check.path in {"/article_summary", "/overall_takeaway"}:
            check.evidence = [Evidence(source="article", comment_id=None, quote=source["article"])]
    review = EditorialReview.model_validate(review.model_dump())
    result = asyncio.run(reviewed_generation(FakeInference([unavailable_draft]),
                                            FakeInference([review]), source))
    assert result.status == "accepted"


@pytest.mark.parametrize("path,notice", [
    ("/discussion_summary/opening", "No additional analysis available."),
    ("/discussion_summary/bullets/0", "No additional analysis available."),
    ("/discussion_points/0/title", "No additional analysis available."),
    ("/overall_takeaway", "Source text unavailable."),
    ("/article_summary", "Source text unavailable."),
])
def test_notices_cannot_bypass_review_with_present_sources(path, notice, source, draft):
    data = draft.model_dump()
    target = data
    parts = path.strip("/").split("/")
    for part in parts[:-1]:
        target = target[int(part)] if isinstance(target, list) else target[part]
    target[int(parts[-1]) if isinstance(target, list) else parts[-1]] = notice
    draft = GeneratedStorySummary.model_validate(data)
    review = verdict(draft)
    next(check for check in review.checks if check.path == path).evidence = []
    with pytest.raises(ValueError, match="no source evidence"):
        validate_review(review, data, source)
    # Even a reviewer supplying an unrelated quote cannot override the state gate.
    result = asyncio.run(reviewed_generation(FakeInference([draft, draft]),
        FakeInference([verdict(draft), verdict(draft)]), source))
    assert result.status == "rejected" and result.draft is None


def test_missing_source_notices_are_exempt_only_on_prescribed_paths(source, unavailable_draft):
    source["article"] = None
    unavailable_draft.article_summary = None
    review = verdict(unavailable_draft)
    for check in review.checks:
        check.evidence = []
    validate_review(review, unavailable_draft.model_dump(), source)
    # An empty source does not allow the notices to swap fields.
    unavailable_draft.overall_takeaway = "No additional analysis available."
    unavailable_draft.discussion_summary.opening = "Source text unavailable."
    review = verdict(unavailable_draft)
    for check in review.checks:
        check.evidence = []
    with pytest.raises(ValueError, match="no source evidence"):
        validate_review(review, unavailable_draft.model_dump(), source)


def test_unusable_page_takeaway_still_requires_evidence(source, unavailable_draft):
    source["article"] = "Access denied."
    review = verdict(unavailable_draft)
    for check in review.checks:
        check.evidence = [Evidence(source="article", comment_id=None, quote=source["article"])]
    next(check for check in review.checks if check.path == "/overall_takeaway").evidence = []
    with pytest.raises(ValueError, match="no source evidence"):
        validate_review(review, unavailable_draft.model_dump(), source)


@pytest.mark.parametrize("defect", ["missing", "unexpected", "duplicate"])
def test_coverage_repair_uses_original_sources_and_exact_paths(defect, source, draft):
    broken = verdict(draft)
    path = broken.checks[0].path
    if defect == "missing":
        broken.checks.pop(0)
    elif defect == "unexpected":
        broken.checks[0].path = "article_summary"
    else:
        broken.checks.append(broken.checks[0])
    writer = FakeInference([draft])
    reviewer = FakeInference([broken, verdict(draft)])
    result = asyncio.run(reviewed_generation(writer, reviewer, source))
    assert result.status == "accepted"
    assert len(writer.calls) == 1
    role, _, payload, _ = reviewer.calls[1]
    assert role == "reviewer_repair"
    assert payload["sources"] == reviewer.calls[0][2]["sources"]
    assert payload["draft"] == draft.model_dump()
    assert payload["prose_fields"] == prose_fields(draft.model_dump())
    assert payload["previous_review"] == broken.model_dump()
    assert payload["coverage_errors"]["duplicates" if defect == "duplicate" else "missing"] == [path]
    if defect == "unexpected":
        assert payload["coverage_errors"]["unexpected"] == ["article_summary"]


def test_each_review_has_only_one_repair_and_revision_is_still_bounded(source, draft):
    broken = verdict(draft)
    broken.checks.pop()
    writer = FakeInference([draft, draft])
    reviewer = FakeInference([broken, verdict(draft, True), broken, verdict(draft)])
    assert asyncio.run(reviewed_generation(writer, reviewer, source)).status == "accepted"
    assert len(writer.calls) == 2
    assert [c[0] for c in reviewer.calls] == ["reviewer", "reviewer_repair"] * 2


@pytest.mark.parametrize("failure", ["coverage", "evidence", "timeout"])
def test_failed_coverage_repair_never_reaches_revision(failure, source, draft):
    broken = verdict(draft)
    broken.checks.pop()
    repaired = verdict(draft)
    if failure == "coverage":
        repaired = broken
    elif failure == "evidence":
        repaired.checks[0].evidence[0].quote = "invented quote"
    else:
        repaired = TimeoutError("repair timeout")
    writer = FakeInference([draft])
    reviewer = FakeInference([broken, repaired])
    with pytest.raises(TimeoutError if failure == "timeout" else ValueError):
        asyncio.run(reviewed_generation(writer, reviewer, source))
    assert len(writer.calls) == 1
    assert len(reviewer.calls) == 2


def test_evidence_failure_does_not_trigger_coverage_repair(source, draft):
    review = verdict(draft)
    review.checks[0].evidence[0].quote = "invented quote"
    reviewer = FakeInference([review])
    with pytest.raises(ValueError, match="original source"):
        asyncio.run(reviewed_generation(FakeInference([draft]), reviewer, source))
    assert len(reviewer.calls) == 1
