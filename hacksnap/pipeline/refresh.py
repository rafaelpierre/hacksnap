"""Bounded parallel refresh with failure isolation, validated writes and inference caching."""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

import httpx

from .config import MAX_STORIES_PER_RUN, Settings
from .image_scope import BACKFILL_START
from .kestrel import FetchError, KestrelFetcher, external_article_url
from .models import (
    DISCUSSION_ANALYSIS_SCHEMA_VERSION,
    CommentSentiment,
    DiscussionAnalysis,
    DiscussionAnalysisMetadata,
    StorySummary,
)
from .preprocess import plain_text, prepare_comments, sample_sentiment_comments, source_fingerprint
from .prompts import DISCUSSION_REFRESH_PROMPT_VERSION, PROMPT_VERSION, SENTIMENT_PROMPT_VERSION
from .summarise import ModalSummarizer, RoutedSummarizer, Summarizer
from .supabase import Repository
from .telemetry import report_error, traced_operation

logger = logging.getLogger("hacksnap")
MAX_PARALLELISM = 15


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
        report_error(error, operation=stage, story_id=story["hn_id"], status=status)
        event["error_type"] = type(error).__name__
        if isinstance(error, httpx.HTTPStatusError):
            event["http_status"] = error.response.status_code
        if isinstance(error, FetchError):
            event["error"] = str(error)  # Our controlled, source-free diagnostic.
    logger.log(logging.WARNING if error else logging.INFO, json.dumps(event))


def discussion_source(
    comments: list[dict], coverage: dict, analysis: DiscussionAnalysis, source_version: str
) -> dict:
    """Canonical refresh inputs; initial generation also primes this cache."""
    return {
        "comments": comments,
        "reference_claims": [claim.model_dump() for claim in analysis.reference_claims],
        "source_version": source_version,
        "schema_version": DISCUSSION_ANALYSIS_SCHEMA_VERSION,
        "coverage": {
            **{key: coverage[key] for key in (
                "stored_comments", "included_comments", "comments_truncated"
            )},
            "selection_method": "active_branches_with_ancestors_v1",
        },
    }


def refresh_discussion(story, existing, comments, coverage, repository, summarizer) -> bool:
    """Use only retained comments and persisted claims; never fetch historical source."""
    analysis = DiscussionAnalysis.model_validate(existing["discussion_analysis"])
    previous = DiscussionAnalysisMetadata.model_validate_json(
        json.dumps(existing["discussion_analysis_metadata"])
    )
    source = discussion_source(comments, coverage, analysis, previous.source_version)
    fingerprint = source_fingerprint(source, summarizer.model, DISCUSSION_REFRESH_PROMPT_VERSION)
    if fingerprint == previous.input_fingerprint:
        # Normalization or sample limits can leave inference inputs unchanged even
        # when the retained raw payload changed. Acknowledge only that payload.
        repository.mark_discussion_contents(story["hn_id"], fingerprint, story.get("content_hash"))
        return False
    result = summarizer.refresh_discussion(source)
    result = DiscussionAnalysis.model_validate_json(result.model_dump_json())
    result.validate_refresh(source["reference_claims"], comments)
    metadata = DiscussionAnalysisMetadata(
        schema_version=DISCUSSION_ANALYSIS_SCHEMA_VERSION,
        prompt_version=DISCUSSION_REFRESH_PROMPT_VERSION,
        model=summarizer.model,
        source_version=previous.source_version,
        input_fingerprint=fingerprint,
        analyzed_at=datetime.now(UTC),
        coverage=source["coverage"],
    )
    metadata.validate_analysis(result, comments)
    if not repository.save_discussion_analysis(
        story["hn_id"], result, metadata, content_hash=story.get("content_hash"),
        expected_fingerprint=previous.input_fingerprint,
    ):
        raise ValueError("Discussion analysis changed during refresh")
    return True


@traced_operation("story_enrichment")
def process_story(
    story: dict,
    repository,
    fetcher,
    summarizer: Summarizer,
    comment_budget: int = 48000,
    prompt_version: str = PROMPT_VERSION,
    image_enabled: bool = False,
) -> str:
    stage = "preprocess"
    try:
        if story.get("full_raw_text_contents") is None:
            log_event(story, stage, "contents_not_retained")
            return "unavailable"
        payload = json.loads(story["full_raw_text_contents"])
        comments, coverage = prepare_comments(payload, comment_budget)
        sentiment_comments = sample_sentiment_comments(comments)
        sentiment_model = getattr(summarizer, "sentiment_model", summarizer.model)
        comments_fingerprint = source_fingerprint(
            {"comments": sentiment_comments}, sentiment_model, SENTIMENT_PROMPT_VERSION
        )
        sentiment_metadata = {
            **coverage,
            "included_comments": len(sentiment_comments),
            "comments_truncated": len(sentiment_comments) < coverage["stored_comments"],
            "comments_fingerprint": comments_fingerprint,
            "model": sentiment_model,
            "prompt_version": SENTIMENT_PROMPT_VERSION,
        }
        existing = repository.get_summary(story["hn_id"])
        if existing:
            analysis_updated = False
            if existing.get("discussion_analysis") is not None:
                stage = "discussion_refresh"
                analysis_updated = refresh_discussion(
                    story, existing, comments, coverage, repository, summarizer
                )
                log_event(story, stage, "analysis_updated" if analysis_updated else "unchanged")
            stage = "sentiment_cache"
            previous = (existing.get("source_coverage") or {}).get("sentiment", {})
            same_comments = previous.get("comments_fingerprint") == comments_fingerprint
            # Legacy scores lack model provenance; refresh once instead of adopting them.
            if same_comments and (existing.get("sentiment") is not None or not comments):
                log_event(story, stage, "unchanged")
                return "analysis_updated" if analysis_updated else "unchanged"
            stage = "sentiment_infer"
            result = (summarizer.estimate_sentiment(sentiment_comments) if sentiment_comments
                      else CommentSentiment(sentiment=None))
            result = CommentSentiment.model_validate(result)
            result.validate_comments(sentiment_comments)
            stage = "sentiment_persist"
            repository.save_sentiment(story["hn_id"], result.sentiment, sentiment_metadata)
            log_event(story, stage, "sentiment_updated")
            return "analysis_updated" if analysis_updated else "sentiment_updated"
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
        # Round-trip also revalidates nested models returned by custom summarizers.
        summary = StorySummary.model_validate_json(summary.model_dump_json())
        summary.validate_sources(article, comments, source["story_text"])
        source_version = source_fingerprint(
            {"article": article, "story_text": source["story_text"]}, "", ""
        )
        metadata = DiscussionAnalysisMetadata(
            schema_version=DISCUSSION_ANALYSIS_SCHEMA_VERSION,
            prompt_version=prompt_version,
            model=summarizer.model,
            source_version=source_version,
            # The initial call already analyzed these comments with these claims.
            # Prime the refresh cache while retaining the actual generation prompt
            # in metadata.prompt_version for provenance.
            input_fingerprint=source_fingerprint(
                discussion_source(comments, coverage, summary.discussion_analysis, source_version),
                summarizer.model,
                DISCUSSION_REFRESH_PROMPT_VERSION,
            ),
            analyzed_at=datetime.now(UTC),
            coverage={
                **{key: coverage[key] for key in (
                    "stored_comments", "included_comments", "comments_truncated"
                )},
                "selection_method": "active_branches_with_ancestors_v1",
            },
        )
        metadata.validate_analysis(summary.discussion_analysis, comments)
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
            discussion_analysis=summary.discussion_analysis,
            discussion_analysis_metadata=metadata,
        )
        if image_enabled:
            # Publication has committed. A queue error cannot hide this story;
            # the independent image sweep reconciles missing queue entries.
            try:
                repository.enqueue_image(
                    story["hn_id"], article_url, added_from=BACKFILL_START,
                )
            except Exception as exc:  # noqa: BLE001 - image work is isolated
                log_event(story, "image_enqueue", "failed", exc)
        log_event(story, stage, "generated")
        return "generated"
    except Exception as error:  # noqa: BLE001 - isolate each story as required by the job contract
        log_event(story, stage, "failed", error)
        return "failed"


@traced_operation("enrichment_batch")
def refresh(repository, fetcher, summarizer, comment_budget: int = 48000,
            *, image_enabled: bool = False) -> dict:
    counts = {
        "generated": 0, "unchanged": 0, "failed": 0, "fetch_skipped": 0,
        "unavailable": 0, "sentiment_updated": 0, "analysis_updated": 0,
    }
    attempted = set()
    # Repository methods open their own connections; the HTTP client and fetcher
    # are safe to share. Only this coordinating thread updates counts/attempted.
    with ThreadPoolExecutor(max_workers=MAX_PARALLELISM) as executor:
        # Re-read the ranking after each completed batch to replace failed articles.
        # Bound work even if many articles fail or ingestion changes the queue.
        while len(attempted) < MAX_STORIES_PER_RUN:
            candidates = [
                story for story in repository.get_current_top_stories(limit=MAX_STORIES_PER_RUN)
                if story["hn_id"] not in attempted
            ]
            if not candidates:
                break
            futures = []
            for story in candidates[:MAX_STORIES_PER_RUN - len(attempted)]:
                attempted.add(story["hn_id"])
                futures.append(executor.submit(
                    process_story, story, repository, fetcher, summarizer, comment_budget,
                    image_enabled=image_enabled,
                ))
            for future in as_completed(futures):
                counts[future.result()] += 1
    if len(attempted) == MAX_STORIES_PER_RUN:
        logger.info(json.dumps({"event": "refresh_attempt_limit", "limit": MAX_STORIES_PER_RUN}))
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
        editorial = ModalSummarizer(
            client,
            settings.llm_base_url,
            settings.llm_model,
            settings.llm_api_key,
            settings.llm_reasoning_effort,
        )
        sentiment = ModalSummarizer(
            client,
            settings.sentiment_base_url,
            settings.sentiment_model,
            settings.sentiment_api_key or settings.llm_api_key,
            settings.sentiment_reasoning_effort,
        )
        summarizer = RoutedSummarizer(editorial, sentiment)
        image_enabled = (
            os.environ.get("HACKSNAP_IMAGES_ENABLED", "").lower() == "true"
            and bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))
        )
        counts = refresh(
            repository, fetcher, summarizer, settings.comment_chars,
            image_enabled=image_enabled,
        )
        cleanup = repository.cleanup_contents()
        logger.info(json.dumps({"event": "contents_cleanup", **cleanup}))
    # Individual stories are failure-isolated. Return their count for monitoring without
    # failing the scheduled invocation after the remaining work and cleanup succeeded.
    return counts


if __name__ == "__main__":
    run()
