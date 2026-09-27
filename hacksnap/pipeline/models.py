from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
CommentID = Annotated[int, Field(strict=True, gt=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


DISCUSSION_ANALYSIS_SCHEMA_VERSION = "1"

Stance = Literal[
    "disagrees", "qualified_disagreement", "mixed", "qualified_agreement", "agrees", "unclear"
]
DiscussionTopicKey = Literal[
    "applicability", "evidence", "technical_limitations", "cost", "ethics",
    "privacy_security", "social_impact", "alternatives", "other",
]
ClaimID = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Fingerprint = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
CommentCount = Annotated[int, Field(strict=True, ge=0)]


class ReferenceClaim(StrictModel):
    id: ClaimID
    text: ShortText
    source: Literal["article", "story_text"]


class CommentHighlight(StrictModel):
    comment_id: CommentID
    claim_id: ClaimID
    stance: Stance
    paraphrase: ShortText
    explanation: ShortText


class CriticalCommentHighlight(CommentHighlight):
    stance: Literal["disagrees", "qualified_disagreement"]


class SupportiveCommentHighlight(CommentHighlight):
    stance: Literal["agrees", "qualified_agreement"]


class DiscussionTopic(StrictModel):
    key: DiscussionTopicKey
    title: Title
    summary: ShortText
    comment_ids: list[CommentID] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def unique_citations(self) -> Self:
        if len(self.comment_ids) != len(set(self.comment_ids)):
            raise ValueError("Topic contains duplicate comment citations")
        return self


class DiscussionAnalysis(StrictModel):
    """Standalone inference contract; source-dependent checks require validate_sources()."""

    status: Literal["available", "no_comments", "insufficient_context"]
    reference_claims: list[ReferenceClaim] = Field(max_length=6)
    critical_comments: list[CriticalCommentHighlight] = Field(max_length=3)
    supportive_comments: list[SupportiveCommentHighlight] = Field(max_length=3)
    topics: list[DiscussionTopic] = Field(max_length=6)

    @model_validator(mode="after")
    def consistent_evidence(self) -> Self:
        claim_ids = [claim.id for claim in self.reference_claims]
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("Analysis contains duplicate claim IDs")
        highlights = [*self.critical_comments, *self.supportive_comments]
        comment_ids = [highlight.comment_id for highlight in highlights]
        if len(comment_ids) != len(set(comment_ids)):
            raise ValueError("Analysis contains duplicate highlights")
        if any(highlight.claim_id not in claim_ids for highlight in highlights):
            raise ValueError("Highlight references an unknown claim")
        if self.status == "no_comments" and (highlights or self.topics):
            raise ValueError("No-comments analysis cannot contain comment evidence")
        if self.status == "insufficient_context" and (self.reference_claims or highlights):
            raise ValueError("Insufficient-context analysis cannot contain claims or highlights")
        if self.status == "available" and not self.reference_claims:
            raise ValueError("Available analysis requires reference claims")
        return self

    def validate_sources(
        self, article: str | None, story_text: str | None, comments: list[dict]
    ) -> None:
        """Validate against the exact prepared inputs, including available parent context.

        This verifies provenance and membership, not semantic entailment of paraphrases.
        """
        self.validate_comments(comments)
        sources = {"article": article, "story_text": story_text}
        if any(not (sources[claim.source] or "").strip() for claim in self.reference_claims):
            raise ValueError("Reference claim requires its supplied source")

    def validate_refresh(self, reference_claims: list[dict], comments: list[dict]) -> None:
        """Refreshes reuse previously source-validated claims verbatim."""
        if [claim.model_dump() for claim in self.reference_claims] != reference_claims:
            raise ValueError("Refresh changed persisted reference claims")
        self.validate_comments(comments)

    def validate_comments(self, comments: list[dict]) -> None:
        if (self.status == "no_comments") != (not comments):
            raise ValueError("Analysis status disagrees with supplied comments")
        if comments and self.reference_claims and self.status != "available":
            raise ValueError("Supplied claims and comments require available analysis")
        known_ids = {comment["id"] for comment in comments}
        cited_ids = {h.comment_id for h in [*self.critical_comments, *self.supportive_comments]}
        cited_ids.update(cid for topic in self.topics for cid in topic.comment_ids)
        if cited_ids - known_ids:
            raise ValueError("Analysis cites comments not supplied to the model")


class DiscussionAnalysisCoverage(StrictModel):
    """Public counts describe prepared inputs, never opinion prevalence or all of HN."""

    stored_comments: CommentCount
    included_comments: CommentCount
    comments_truncated: bool
    selection_method: Literal["active_branches_with_ancestors_v1"]

    @model_validator(mode="after")
    def consistent_counts(self) -> Self:
        if self.included_comments > self.stored_comments:
            raise ValueError("Included comments cannot exceed usable stored comments")
        if self.comments_truncated != (self.included_comments < self.stored_comments):
            raise ValueError("Truncation flag disagrees with coverage counts")
        return self


class DiscussionAnalysisMetadata(StrictModel):
    """Application-owned provenance; never ask the inference model to invent these fields.

    Only coverage and analyzed_at are public. Versions, fingerprints and model stay internal.
    """

    schema_version: Literal["1"]
    prompt_version: Title
    model: Title
    source_version: Fingerprint
    input_fingerprint: Fingerprint
    analyzed_at: AwareDatetime
    coverage: DiscussionAnalysisCoverage

    def validate_analysis(self, analysis: DiscussionAnalysis, comments: list[dict]) -> None:
        if self.coverage.included_comments != len(comments):
            raise ValueError("Coverage disagrees with supplied comments")
        if (analysis.status == "no_comments") != (not comments):
            raise ValueError("Analysis status disagrees with coverage")


class DiscussionPoint(StrictModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    summary: Text
    comment_ids: list[CommentID] = Field(min_length=1, max_length=12)


class CommentSentiment(StrictModel):
    sentiment: Annotated[int, Field(strict=True, ge=-1, le=1)] | None

    def validate_comments(self, comments: list[dict]) -> None:
        if not comments and self.sentiment is not None:
            raise ValueError("Sentiment requires supplied comments")
        if comments and self.sentiment is None:
            raise ValueError("Summary omits discussion sentiment")


class StorySummary(StrictModel):
    discussion_analysis: DiscussionAnalysis
    article_summary: Text | None
    article_key_points: list[Text] = Field(max_length=6)
    discussion_summary: Text
    discussion_points: list[DiscussionPoint] = Field(max_length=6)
    sentiment: Annotated[int, Field(strict=True, ge=-1, le=1)] | None
    overall_takeaway: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=220)]

    def validate_sources(
        self, article: str | None, comments: list[dict], story_text: str | None = None
    ) -> None:
        if not comments and self.sentiment is not None:
            raise ValueError("Sentiment requires supplied comments")
        if comments and self.sentiment is None:
            raise ValueError("Summary omits discussion sentiment")
        known_ids = {comment["id"] for comment in comments}
        if any(set(point.comment_ids) - known_ids for point in self.discussion_points):
            raise ValueError("Summary cites comments not supplied to the model")
        if article is None and (self.article_summary is not None or self.article_key_points):
            raise ValueError("Summary contains article claims without an article")
        if article and (not self.article_summary or not self.article_key_points):
            raise ValueError("Summary omits the supplied article")
        if comments and not self.discussion_points:
            raise ValueError("Summary omits the supplied discussion")
        self.discussion_analysis.validate_sources(article, story_text, comments)
