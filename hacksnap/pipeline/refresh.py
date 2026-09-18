"""Sequential, failure-isolated refresh with validated writes and inference caching."""

import json
import logging
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

import httpx

from .config import Settings
from .kestrel import FetchError, KestrelFetcher, external_article_url
from .models import StorySummary
from .preprocess import plain_text, prepare_comments, source_fingerprint
from .prompts import PROMPT_VERSION
from .summarise import ModalSummarizer, Summarizer
from .supabase import Repository

logger = logging.getLogger("hacksnap")


def log_event(story: dict, stage: str, status: str, error: Exception | None = None):
    try:
        url = urlsplit(story.get("url") or "")
        safe_url = urlunsplit((url.scheme, url.hostname or "", url.path, "", ""))
    except ValueError:
        safe_url = "[invalid URL]"
    # Exception messages can include credentials, raw source, response bodies or database DSNs.
    event = {
        "timestamp": datetime.now(UTC).isoformat(),
        "story_id": story["hn_id"],
        "url": safe_url,
        "stage": stage,
        "status": status,
    }
    if error:
        event["error_type"] = type(error).__name__
        if isinstance(error, httpx.HTTPStatusError):
            event["http_status"] = error.response.status_code
        if isinstance(error, FetchError):
            event["error"] = str(error)  # Our controlled, source-free diagnostic.
    logger.log(logging.WARNING if error else logging.INFO, json.dumps(event))


def process_story(
    story: dict,
    repository,
    fetcher,
    summarizer: Summarizer,
    comment_budget: int = 48000,
    prompt_version: str = PROMPT_VERSION,
) -> str:
    stage = "preprocess"
    try:
        payload = json.loads(story["full_raw_text_contents"])
        comments, coverage = prepare_comments(payload, comment_budget)
        article_url = external_article_url(story.get("url"))
        article = None
        stage = "fetch"
        if article_url:
            try:
                article = fetcher.fetch(article_url)
            except FetchError as error:
                log_event(story, stage, "failed", error)
                # Preserve a previous complete summary; transient fetch errors must not
                # replace it with a discussion-only version. New stories may still be useful.
                if repository.get_summary(story["hn_id"]):
                    return "failed"
                coverage["article_status"] = "unavailable"
        coverage.setdefault("article_status", "fetched" if article else "not_applicable")
        source = {
            "title": story["title"],
            "article_url": article_url,
            "article": article,
            "story_text": plain_text(payload.get("story", {}).get("text") or "")[:8000],
            "comments": comments,
        }
        stage = "cache"
        fingerprint = source_fingerprint(source, summarizer.model, prompt_version)
        existing = repository.get_summary(story["hn_id"])
        if existing and existing["source_fingerprint"] == fingerprint:
            log_event(story, stage, "unchanged")
            return "unchanged"
        stage = "infer"
        summary = summarizer.summarize(source)
        stage = "validate"
        summary = StorySummary.model_validate(summary)
        summary.validate_sources(article, comments)
        stage = "persist"
        repository.save_summary(
            story["hn_id"],
            article_url,
            summary,
            fingerprint,
            summarizer.model,
            prompt_version,
            coverage,
        )
        log_event(story, stage, "generated")
        return "generated"
    except Exception as error:  # noqa: BLE001 - isolate each story as required by the job contract
        log_event(story, stage, "failed", error)
        return "failed"


def refresh(repository, fetcher, summarizer, comment_budget: int = 48000) -> dict:
    counts = {"generated": 0, "unchanged": 0, "failed": 0}
    for story in repository.get_current_top_stories(limit=10):
        result = process_story(story, repository, fetcher, summarizer, comment_budget)
        counts[result] += 1
    logger.info(json.dumps({"event": "refresh_completed", **counts}))
    return counts


def run() -> dict:
    settings = Settings.from_env()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    # Keep httpx request URLs out of logs: endpoints may contain sensitive routing data.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    repository = Repository(settings.database_url)
    fetcher = KestrelFetcher(
        settings.kestrel_binary, settings.fetch_timeout, settings.article_chars
    )
    with httpx.Client(timeout=settings.llm_timeout) as client:
        summarizer = ModalSummarizer(
            client,
            settings.llm_base_url,
            settings.llm_model,
            settings.llm_api_key,
            settings.llm_reasoning_effort,
        )
        return refresh(repository, fetcher, summarizer, settings.comment_chars)


if __name__ == "__main__":
    run()
