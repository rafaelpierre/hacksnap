from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
CommentID = Annotated[int, Field(strict=True, gt=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


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
    article_summary: Text | None
    article_key_points: list[Text] = Field(max_length=6)
    discussion_summary: Text
    discussion_points: list[DiscussionPoint] = Field(max_length=6)
    sentiment: Annotated[int, Field(strict=True, ge=-1, le=1)] | None
    overall_takeaway: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=220)]

    def validate_sources(self, article: str | None, comments: list[dict]) -> None:
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
