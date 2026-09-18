"""Structured inference against a configurable Modal-hosted compatible endpoint."""

import json
from typing import Protocol
from uuid import uuid4

import httpx

from .models import StorySummary
from .prompts import SYSTEM_PROMPT


class Summarizer(Protocol):
    model: str

    def summarize(self, source: dict) -> StorySummary: ...


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
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(source, ensure_ascii=False)},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "hacksnap_summary",
                        "strict": True,
                        "schema": StorySummary.model_json_schema(),
                    },
                },
            },
        )
        response.raise_for_status()
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise ValueError("Model response did not complete normally")
        result = StorySummary.model_validate_json(choice["message"]["content"])
        result.validate_sources(source["article"], source["comments"])
        return result
