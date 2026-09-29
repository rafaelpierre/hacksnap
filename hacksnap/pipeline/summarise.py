"""Structured inference against a configurable Modal-hosted compatible endpoint."""

import json
import logging
from threading import Event, Lock
from time import perf_counter
from typing import Protocol
from uuid import uuid4

import httpx

from .models import CommentSentiment, DiscussionAnalysis, GeneratedStorySummary, StorySummary
from .preprocess import sample_sentiment_comments
from .prompts import DISCUSSION_REFRESH_PROMPT, SENTIMENT_PROMPT, SYSTEM_PROMPT

# Includes reasoning tokens; 8,000 truncated production summary and discussion outputs.
MAX_RESPONSE_TOKENS = 32000
logger = logging.getLogger("hacksnap")


class Summarizer(Protocol):
    model: str

    def summarize(self, source: dict) -> StorySummary: ...

    def estimate_sentiment(self, comments: list[dict]) -> CommentSentiment: ...

    def refresh_discussion(self, source: dict) -> DiscussionAnalysis: ...


class RoutedSummarizer:
    """Keep editorial inference separate from the model that owns sentiment."""

    def __init__(self, editorial: Summarizer, sentiment: Summarizer):
        self.editorial = editorial
        self.sentiment = sentiment
        self.model = editorial.model
        self.sentiment_model = sentiment.model

    def summarize(self, source: dict) -> StorySummary:
        summary = self.editorial.summarize(source)
        score = self.estimate_sentiment(source["comments"])
        # Preserve the established editorial schema; replace only its score.
        return StorySummary.model_validate({**summary.model_dump(), "sentiment": score.sentiment})

    def estimate_sentiment(self, comments: list[dict]) -> CommentSentiment:
        result = CommentSentiment.model_validate(self.sentiment.estimate_sentiment(comments))
        result.validate_comments(comments)
        return result

    def refresh_discussion(self, source: dict) -> DiscussionAnalysis:
        return self.editorial.refresh_discussion(source)


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
        self._warmup_states: dict[tuple[str, type, str], Event] = {}
        self._warmup_states_lock = Lock()
        self._warmup_lock = Lock()

    def summarize(self, source: dict) -> StorySummary:
        source = {**source, "sentiment_comments": sample_sentiment_comments(source["comments"])}
        generated = self._infer(source, SYSTEM_PROMPT, GeneratedStorySummary, "hacksnap_summary")
        if not source["comments"] and generated.discussion_summary.bullets:
            raise ValueError("Discussion bullets require supplied comments")
        if source["comments"] and not generated.discussion_summary.bullets:
            raise ValueError("Summary omits discussion bullets for supplied comments")
        result = generated.to_summary()
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
        # A discussion or sentiment request cannot warm the summary prefix.
        # Track each prompt/schema independently while serializing cold requests.
        key = (prompt, schema, name)
        with self._warmup_states_lock:
            owns_warmup = key not in self._warmup_states
            if owns_warmup:
                self._warmup_states[key] = Event()
            complete = self._warmup_states[key]
        if owns_warmup:
            try:
                # Only the first request for each key queues for this lock.
                with self._warmup_lock:
                    return self._request_inference(source, prompt, schema, name)
            finally:
                # Release this key's waiters even on failure, independently of
                # whichever unrelated cold prompt acquires the global lock next.
                complete.set()
        complete.wait()
        return self._request_inference(source, prompt, schema, name)

    def _request_inference(self, source: dict, prompt: str, schema, name: str):
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
