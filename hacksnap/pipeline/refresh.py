"""Sequential, failure-isolated refresh with validated writes and inference caching."""

import json
import logging
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

import httpx

from .config import Settings
from .kestrel import FetchError, KestrelFetcher, external_article_url
from .models import CommentSentiment, StorySummary
from .preprocess import plain_text, prepare_comments, sample_sentiment_comments, source_fingerprint
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
        if story.get("full_raw_text_contents") is None:
            log_event(story, stage, "contents_not_retained")
            return "unavailable"
        payload = json.loads(story["full_raw_text_contents"])
        comments, coverage = prepare_comments(payload, comment_budget)
        sentiment_comments = sample_sentiment_comments(comments)
        comments_fingerprint = source_fingerprint({"comments": sentiment_comments}, "", "")
        sentiment_metadata = {
            **coverage,
            "included_comments": len(sentiment_comments),
            "comments_truncated": len(sentiment_comments) < coverage["stored_comments"],
            "comments_fingerprint": comments_fingerprint,
        }
        existing = repository.get_summary(story["hn_id"])
        if existing:
            stage = "sentiment_cache"
            previous = (existing.get("source_coverage") or {}).get("sentiment", {})
            same_comments = previous.get("comments_fingerprint") == comments_fingerprint
            # Adopt the cache for already-scored legacy rows when their full inputs match.
            legacy_unchanged = (
                not previous and len(comments) <= 10 and story.get("content_hash") is not None
                and existing.get("summarized_content_hash") == story["content_hash"]
                and existing.get("sentiment") is not None
            )
            if legacy_unchanged:
                repository.save_sentiment(story["hn_id"], existing["sentiment"], sentiment_metadata)
                return "unchanged"
            if same_comments and (existing.get("sentiment") is not None or not comments):
                log_event(story, stage, "unchanged")
                return "unchanged"
            stage = "sentiment_infer"
            result = (summarizer.estimate_sentiment(sentiment_comments) if sentiment_comments
                      else CommentSentiment(sentiment=None))
            result = CommentSentiment.model_validate(result)
            result.validate_comments(sentiment_comments)
            stage = "sentiment_persist"
            repository.save_sentiment(story["hn_id"], result.sentiment, sentiment_metadata)
            log_event(story, stage, "sentiment_updated")
            return "sentiment_updated"
        article_url = external_article_url(story.get("url"))
        article = None
        stage = "fetch"
        if article_url:
            try:
                article = fetcher.fetch(article_url)
            except FetchError as error:
                log_event(story, stage, "fetch_skipped", error)
                stage = "persist_fetch_failure"
                repository.save_fetch_failure(story["hn_id"], article_url)
                return "fetch_skipped"
        coverage.setdefault("article_status", "fetched" if article else "not_applicable")
        source = {
            "title": story["title"],
            "article_url": article_url,
            "article": article,
            "story_text": plain_text(payload.get("story", {}).get("text") or "")[:8000],
            "comments": comments,
            "sentiment_comments": sentiment_comments,
        }
        stage = "cache"
        fingerprint = source_fingerprint(source, summarizer.model, prompt_version)
        stage = "infer"
        summary = summarizer.summarize(source)
        stage = "validate"
        summary = StorySummary.model_validate(summary)
        summary.validate_sources(article, comments)
        stage = "persist"
        coverage["sentiment"] = sentiment_metadata
        repository.save_summary(
            story["hn_id"],
            article_url,
            summary,
            fingerprint,
            summarizer.model,
            prompt_version,
            coverage,
            story.get("content_hash"),
        )
        log_event(story, stage, "generated")
        return "generated"
    except Exception as error:  # noqa: BLE001 - isolate each story as required by the job contract
        log_event(story, stage, "failed", error)
        return "failed"


def refresh(repository, fetcher, summarizer, comment_budget: int = 48000) -> dict:
    counts = {
        "generated": 0, "unchanged": 0, "failed": 0, "fetch_skipped": 0,
        "unavailable": 0, "sentiment_updated": 0,
    }
    attempted = set()
    # Re-read the shared ranking after failures so replacements are processed now.
    # Bound work even if many articles are inaccessible or ingestion changes the queue.
    while len(attempted) < 50:
        candidates = [
            story for story in repository.get_current_top_stories(limit=10)
            if story["hn_id"] not in attempted
        ]
        if not candidates:
            break
        for story in candidates[:50 - len(attempted)]:
            attempted.add(story["hn_id"])
            result = process_story(story, repository, fetcher, summarizer, comment_budget)
            counts[result] += 1
    if len(attempted) == 50:
        logger.warning(json.dumps({"event": "refresh_attempt_limit", "limit": 50}))
    # Capture the final ordering after failed articles have been excluded.
    repository.record_rank_history()
    logger.log(
        logging.ERROR if counts["failed"] else logging.INFO,
        json.dumps({"event": "refresh_completed", "status": "failed" if counts["failed"] else "succeeded", **counts}),
    )
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
        counts = refresh(repository, fetcher, summarizer, settings.comment_chars)
        cleanup = repository.cleanup_contents()
        logger.info(json.dumps({"event": "contents_cleanup", **cleanup}))
    # Individual stories are failure-isolated. Return their count for monitoring without
    # failing the scheduled invocation after the remaining work and cleanup succeeded.
    return counts


if __name__ == "__main__":
    run()
