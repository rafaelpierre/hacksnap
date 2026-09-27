"""Structured inference against a configurable Modal-hosted compatible endpoint."""

import json
import logging
from time import perf_counter
from typing import Protocol
from uuid import uuid4

import httpx

from .models import CommentSentiment, DiscussionAnalysis, StorySummary
from .preprocess import sample_sentiment_comments
from .prompts import DISCUSSION_REFRESH_PROMPT, SENTIMENT_PROMPT, SYSTEM_PROMPT

MAX_RESPONSE_TOKENS = 8000
logger = logging.getLogger("hacksnap")


class Summarizer(Protocol):
    model: str

    def summarize(self, source: dict) -> StorySummary: ...

    def estimate_sentiment(self, comments: list[dict]) -> CommentSentiment: ...

    def refresh_discussion(self, source: dict) -> DiscussionAnalysis: ...


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
        result.validate_sources(source["article"], source["comments"], source.get("story_text"))
        return result

    def refresh_discussion(self, source: dict) -> DiscussionAnalysis:
        result = self._infer(
            source, DISCUSSION_REFRESH_PROMPT, DiscussionAnalysis, "hacksnap_discussion_refresh"
        )
        result.validate_refresh(source["reference_claims"], source["comments"])
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
        started = perf_counter()
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
                "max_tokens": MAX_RESPONSE_TOKENS,
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
        payload = response.json()
        choice = payload["choices"][0]
        # Allowlist metrics only: never log content, endpoint, credentials or raw usage.
        usage = payload.get("usage") or {}
        logger.info(json.dumps({
            "event": "inference_completed",
            "schema": name,
            "elapsed_seconds": round(perf_counter() - started, 3),
            "max_tokens": MAX_RESPONSE_TOKENS,
            "completed": choice.get("finish_reason") == "stop",
            **{key: usage[key] for key in ("prompt_tokens", "completion_tokens", "total_tokens")
               if type(usage.get(key)) is int and usage[key] >= 0},
        }))
        if choice.get("finish_reason") != "stop":
            raise ValueError("Model response did not complete normally")
        return schema.model_validate_json(choice["message"]["content"])
