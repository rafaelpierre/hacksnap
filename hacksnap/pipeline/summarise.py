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
from .telemetry import post_chat_completion, traced_operation

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

    @traced_operation("summarization_pipeline")
    def summarize(self, source: dict) -> StorySummary:
        summary = self.editorial.summarize(source)
        score = self.estimate_sentiment(source["comments"])
        # Preserve the established editorial schema; replace only its score.
        return StorySummary.model_validate({**summary.model_dump(), "sentiment": score.sentiment})

    @traced_operation("sentiment_pipeline", model_attribute="sentiment_model")
    def estimate_sentiment(self, comments: list[dict]) -> CommentSentiment:
        result = CommentSentiment.model_validate(self.sentiment.estimate_sentiment(comments))
        result.validate_comments(comments)
        return result

    @traced_operation("discussion_pipeline")
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

    @traced_operation("summarization")
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

    @traced_operation("discussion_analysis")
    def refresh_discussion(self, source: dict) -> DiscussionAnalysis:
        result = self._infer(
            source, DISCUSSION_REFRESH_PROMPT, DiscussionAnalysis, "hacksnap_discussion_refresh"
        )
        result.validate_refresh(source["reference_claims"], source["comments"])
        return result

    @traced_operation("sentiment_analysis")
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
        started = perf_counter()
        request_started = None
        status = "failed"
        try:
            if owns_warmup:
                try:
                    # First requests serialize; warmed prompts proceed independently.
                    with self._warmup_lock:
                        request_started = perf_counter()
                        result = self._request_inference(source, prompt, schema, name)
                finally:
                    complete.set()
            else:
                complete.wait()
                request_started = perf_counter()
                result = self._request_inference(source, prompt, schema, name)
            status = "succeeded"
            return result
        finally:
            finished = perf_counter()
            logger.info(json.dumps({
                "event": "inference_timing", "schema": name, "model": self.model,
                "warmup_owner": owns_warmup, "status": status,
                "warmup_wait_seconds": round((request_started if request_started is not None else finished) - started, 3),
                "request_seconds": round(finished - request_started, 3) if request_started is not None else 0,
                "total_seconds": round(finished - started, 3),
            }))

    def _request_inference(self, source: dict, prompt: str, schema, name: str):
        started = perf_counter()
        response = post_chat_completion(
            self.client,
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
