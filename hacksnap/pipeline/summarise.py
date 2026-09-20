"""Structured inference against a configurable Modal-hosted compatible endpoint."""

import json
from typing import Protocol
from uuid import uuid4

import httpx

from .models import CommentSentiment, StorySummary
from .preprocess import sample_sentiment_comments
from .prompts import SENTIMENT_PROMPT, SYSTEM_PROMPT


class Summarizer(Protocol):
    model: str

    def summarize(self, source: dict) -> StorySummary: ...

    def estimate_sentiment(self, comments: list[dict]) -> CommentSentiment: ...


class ModalSummarizer:
    def __init__(
        self,
        client: httpx.Client,
        base_url: str,
        model: str,
        api_key: str,
        reasoning_effort: str = "low",
    ):
        self.client, self.base_url, self.model, self.api_key = client, base_url, model, api_key
        self.reasoning_effort = reasoning_effort
        # run() creates one summarizer per batch; affinity is scoped to that run.
        self.session_id = str(uuid4())

    def summarize(self, source: dict) -> StorySummary:
        source = {**source, "sentiment_comments": sample_sentiment_comments(source["comments"])}
        result = self._infer(source, SYSTEM_PROMPT, StorySummary, "hacksnap_summary")
        result.validate_sources(source["article"], source["comments"])
        return result

    def estimate_sentiment(self, comments: list[dict]) -> CommentSentiment:
        comments = sample_sentiment_comments(comments)
        if not comments:
            return CommentSentiment(sentiment=None)
        result = self._infer(
            {"comments": comments}, SENTIMENT_PROMPT, CommentSentiment, "hacksnap_sentiment"
        )
        result.validate_comments(comments)
        return result

    def _infer(self, source: dict, prompt: str, schema, name: str):
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Modal-Session-Id": self.session_id,
            },
            json={
                "model": self.model,
                "temperature": 0.2,
                "reasoning_effort": self.reasoning_effort,
                "max_tokens": 8000,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": json.dumps(source, ensure_ascii=False)},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": name,
                        "strict": True,
                        "schema": schema.model_json_schema(),
                    },
                },
            },
        )
        response.raise_for_status()
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise ValueError("Model response did not complete normally")
        return schema.model_validate_json(choice["message"]["content"])
