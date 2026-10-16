"""Bounded SEO enrichment over published content; failures preserve publication."""

import asyncio
import hashlib
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import UTC, datetime
from time import monotonic
from typing import Annotated

from pydantic import StringConstraints, field_validator

from .editorial_agents import REQUEST_FORMAT_VERSION, AgentInference
from .editorial_cache import EditorialCache
from .models import StrictModel
from .preprocess import source_fingerprint
from .seo_prompts import SEO_PROMPT, SEO_PROMPT_VERSION
from .telemetry import traced_operation

logger = logging.getLogger("hacksnap.seo")
# Selection and save (10s connect + 15s statement each), 65s inference,
# and a small margin. Do not start a job that cannot fit the remaining budget.
SEO_JOB_RESERVE_SECONDS = 125


class SearchMetadata(StrictModel):
    # Editorial bounds, not Google's display limits. Never truncate generated copy.
    seo_title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    seo_description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]

    @field_validator("seo_title", "seo_description", mode="before")
    @classmethod
    def plain_text(cls, value):
        if isinstance(value, str) and (
            re.search(r"[\x00-\x1f\x7f<>`]|\*\*|\[[^]]+\]\(|https?://", value)
            or value.strip().startswith(('"', "'"))
            or value.rstrip().endswith(("…", "..."))
        ):
            raise ValueError("SEO copy must be complete single-line plain text")
        return value

    @field_validator("seo_title")
    @classmethod
    def no_brand_suffix(cls, value):
        if re.search(r"\s[|–—-]\s*Hacksnap$", value, re.IGNORECASE):
            raise ValueError("The application adds the brand suffix")
        return value


def seo_source(row: dict) -> dict:
    """Only visible editorial content affects the fingerprint, never scores or timestamps."""
    return {
        "original_title": row["original_title"],
        "headline": row.get("title") or row["original_title"],
        "article_summary": row.get("article_summary"),
        "article_key_points": row.get("article_key_points") or [],
        "overall_takeaway": row["overall_takeaway"],
        "article_status": (row.get("source_coverage") or {}).get("article_status"),
        # Initial published brief fields are stable across routine discussion refreshes.
        "discussion_themes": row.get("discussion_points") or [],
    }


class SeoAgent:
    def __init__(self, settings):
        self.model = settings.llm_model
        self.config = {
            "base_url": settings.llm_base_url, "api_key": settings.llm_api_key,
            "model": self.model, "effort": "low", "timeout": 60,
            # Completion tokens include reasoning, even for two short output fields.
            "cache": EditorialCache(), "max_tokens": 10000,
        }
        identity = [SEO_PROMPT_VERSION, SEO_PROMPT, SearchMetadata.model_json_schema(),
                    REQUEST_FORMAT_VERSION, self.model, self.config["effort"],
                    self.config["max_tokens"]]
        self.version = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()

    @traced_operation("seo_generation")
    def generate(self, source: dict) -> SearchMetadata:
        return asyncio.run(self._generate(source))

    async def _generate(self, source):
        client = AgentInference(**self.config)
        try:
            # The outer bound also includes waiting for another story's prefix warm-up.
            async with asyncio.timeout(65):
                result = await client.infer("seo", SEO_PROMPT, source, SearchMetadata)
            return SearchMetadata.model_validate(result)
        finally:
            for call in client.calls:
                logger.info(json.dumps({"event": "seo_inference", **call}))
            await client.close()


def process_seo(row, repository, agent, *, deadline=None):
    if deadline is not None and monotonic() + SEO_JOB_RESERVE_SECONDS >= deadline:
        return "deferred"
    try:
        source = seo_source(row)
        fingerprint = source_fingerprint(source, agent.model, agent.version)
        previous = row.get("seo_metadata") or {}
        if previous.get("input_fingerprint") == fingerprint:
            return "unchanged"
        result = agent.generate(source)
        result = SearchMetadata.model_validate_json(result.model_dump_json())
        provenance = {
            "model": agent.model, "prompt_version": SEO_PROMPT_VERSION,
            "generation_version": agent.version, "input_fingerprint": fingerprint,
            "generated_at": datetime.now(UTC).isoformat(),
        }
        return "generated" if repository.save_seo(row, result, provenance) else "stale"
    except Exception as error:  # noqa: BLE001 - optional enrichment cannot unpublish content
        logger.warning("seo_failed story_id=%s error_type=%s", row["story_id"], type(error).__name__)
        return "failed"


def refresh_seo(repository, agent, *, limit=50, after_id=None, deadline=None):
    rows = repository.seo_candidates(limit=limit, after_id=after_id)
    counts = dict.fromkeys(("generated", "unchanged", "failed", "stale", "deferred"), 0)
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(copy_context().run, process_seo, row, repository, agent,
                                   deadline=deadline) for row in rows]
        for future in futures:
            counts[future.result()] += 1
    logger.info(json.dumps({"event": "seo_batch_completed", **counts}))
    return {**counts, "last_id": rows[-1]["story_id"] if rows else None}
