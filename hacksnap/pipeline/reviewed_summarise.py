"""Production editorial adapter with isolated async clients per story operation."""
import asyncio
import hashlib
import json
import logging

from .config import Settings
from .editorial_agents import AgentInference
from .editorial_prompts import DISCUSSION_REFRESH_PROMPT, SYSTEM_PROMPT
from .editorial_review import (
    REVIEW_PROMPT,
    REVIEW_REPAIR_PROMPT,
    REVIEW_VERSION,
    REVISION_PROMPT,
    reviewed_generation,
)
from .models import GeneratedDiscussionAnalysis, GeneratedStorySummary
from .telemetry import traced_operation

logger = logging.getLogger("hacksnap")


class EditorialRejected(ValueError):
    """No draft passed the bounded editorial review; preserve stored content."""


class ReviewedSummarizer:
    def __init__(self, settings: Settings, *, deadline: float | None = None):
        self.model = settings.llm_model
        self.deadline = deadline
        self.writer_config = {
            "base_url": settings.llm_base_url, "api_key": settings.llm_api_key,
            "model": settings.llm_model, "effort": settings.llm_reasoning_effort,
            "timeout": settings.llm_timeout,
        }
        self.reviewer_config = {
            "base_url": settings.sentiment_base_url,
            "api_key": settings.sentiment_api_key or settings.llm_api_key,
            "model": settings.sentiment_model, "effort": "high",
            "timeout": settings.reviewer_timeout,
        }
        self.prompt_version = self._version(SYSTEM_PROMPT)
        self.discussion_prompt_version = self._version(DISCUSSION_REFRESH_PROMPT)

    def _version(self, prompt):
        # Every prompt that can affect an accepted draft participates in the cache key.
        identity = [prompt, REVIEW_PROMPT, REVIEW_REPAIR_PROMPT, REVISION_PROMPT,
                    REVIEW_VERSION, self.model,
                    self.writer_config["effort"], self.reviewer_config["model"],
                    self.reviewer_config["effort"]]
        digest = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:20]
        return f"reviewed-v1-{digest}"

    @traced_operation("reviewed_summary")
    def summarize(self, source):
        draft = asyncio.run(self._generate(source, "summary"))
        return GeneratedStorySummary.model_validate(draft).to_summary()

    @traced_operation("reviewed_discussion")
    def refresh_discussion(self, source):
        draft = asyncio.run(self._generate(source, "refresh"))
        return GeneratedDiscussionAnalysis.model_validate(draft).to_analysis()

    async def _generate(self, source, operation):
        # The worker shares this adapter across threads. Never share an HTTP client,
        # event loop or AgentInference's mutable call records between operations.
        writer = AgentInference(**self.writer_config)
        try:
            reviewer = AgentInference(**self.reviewer_config)
            try:
                result = await reviewed_generation(
                    writer, reviewer, source, operation, deadline=self.deadline,
                )
                log = logger.warning if result.status == "unreviewed" else logger.info
                log(json.dumps({"event": "editorial_review_completed",
                    "operation": operation, "status": result.status,
                    "review_passes": len(result.history),
                    "fail_open": result.status == "unreviewed",
                    "fallback_reason": result.fallback_reason}))
                if result.status == "rejected" or result.draft is None:
                    raise EditorialRejected("Editorial review rejected the draft")
                return result.draft
            finally:
                for call in reviewer.calls:
                    logger.info(json.dumps({"event": "editorial_inference", **call}))
                await reviewer.close()
        finally:
            for call in writer.calls:
                logger.info(json.dumps({"event": "editorial_inference", **call}))
            await writer.close()
