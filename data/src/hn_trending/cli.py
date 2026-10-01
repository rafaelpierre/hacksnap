"""Click entry point for collecting Hacker News trending threads."""

from __future__ import annotations

import json
import logging
import os
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextvars import copy_context
from threading import Lock
from time import perf_counter
from typing import Any
from urllib.parse import quote

import click
import httpx

from hn_trending.client import HackerNewsClient, retain_comments_with_descendants
from hn_trending.categories import CATEGORY_VERSION, category_metadata, reusable_category
from hn_trending.storage import (
    database_row,
    get_category_assignments,
    finish_ingestion_run,
    start_ingestion_run,
    store_threads_and_snapshots,
)
from hn_trending.telemetry import report_error, traced_operation
from hn_trending.topic_filter import MODAL_LLM_BASE_URL, MODAL_LLM_MODEL, TitleTopicClassifier


def title_matches(title: str, title_words: tuple[str, ...]) -> bool:
    """Return true when any requested word occurs in the title, ignoring case."""
    normalized_title = title.casefold()
    return not title_words or any(word.casefold() in normalized_title for word in title_words)


def raw_thread_contents(story: dict[str, Any], comments: list[dict[str, Any]]) -> str:
    """Serialize the exact API payloads collected for a thread and its comments."""
    return json.dumps({"story": story, "comments": comments}, ensure_ascii=False)


def resolve_database_url() -> str:
    """Safely compose this project's IPv4 Supabase pooler connection URL."""
    password = os.environ.get("SUPABASE_PASSWORD")
    if password:
        encoded_password = quote(password, safe="")
        return (
            "postgresql://postgres.tbihbssiluihmnseuknk:"
            f"{encoded_password}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
            "?sslmode=require"
        )
    raise click.UsageError("Set SUPABASE_PASSWORD.")


@click.command()
@click.option(
    "--title-word",
    "title_words",
    multiple=True,
    metavar="WORD",
    help="Require at least one supplied word in the title (case-insensitive). Repeatable.",
)
@click.option("--min-comments", type=click.IntRange(min=0), default=0, show_default=True)
@click.option("--min-points", type=click.IntRange(min=0), default=0, show_default=True)
@click.option(
    "--max-comment-depth",
    type=click.IntRange(min=0),
    default=5,
    show_default=True,
    help="Maximum comment nesting level to retrieve; direct comments are depth 1.",
)
@click.option(
    "--min-comment-descendants",
    type=click.IntRange(min=0),
    default=0,
    show_default=True,
    help="Keep comments with this many descendants in the fetched tree, plus ancestors.",
)
@click.option(
    "--classify-topic/--no-classify-topic",
    default=False,
    show_default=True,
    help="Use GLM Flash NVFP4 on Modal to gate titles for AI-news relevance.",
)
@click.option(
    "--limit",
    type=click.IntRange(min=1),
    default=100,
    show_default=True,
    help="Number of top-story IDs to consider from the HN API.",
)
@click.option(
    "--story-concurrency",
    type=click.IntRange(min=1, max=16),
    default=4,
    show_default=True,
    help="Maximum stories processed concurrently; use 1 for sequential ingestion.",
)
@traced_operation("ingestion")
def main(
    title_words: tuple[str, ...],
    min_comments: int,
    min_points: int,
    max_comment_depth: int,
    min_comment_descendants: int,
    classify_topic: bool,
    limit: int,
    story_concurrency: int,
) -> None:
    """Fetch filtered top HN stories and save their raw thread contents to Supabase."""
    classifier: TitleTopicClassifier | None = None
    if classify_topic:
        modal_api_key = os.environ.get("MODAL_LLM_API_KEY")
        if not modal_api_key:
            raise click.UsageError("Set MODAL_LLM_API_KEY when using --classify-topic.")
        classifier = TitleTopicClassifier(
            modal_api_key,
            base_url=os.environ.get("MODAL_LLM_BASE_URL", MODAL_LLM_BASE_URL),
            model=os.environ.get("MODAL_LLM_MODEL", MODAL_LLM_MODEL),
        )

    database_url = resolve_database_url()
    run_filters = {
        "title_words": list(title_words),
        "min_comments": min_comments,
        "min_points": min_points,
        "max_comment_depth": max_comment_depth,
        "min_comment_descendants": min_comment_descendants,
        "classify_topic": classify_topic,
        "category_version": CATEGORY_VERSION if classify_topic else None,
        "limit": limit,
        "story_concurrency": story_concurrency,
    }
    run_id = start_ingestion_run(database_url, run_filters)
    click.echo(f"Created ingestion run {run_id}.")

    started = perf_counter()
    status = "failed"
    rows: list[dict[str, Any]] = []
    detected = 0
    filtered = 0
    skipped = 0
    examined = 0
    snapshots_inserted = 0
    counter_lock = Lock()
    classification_lock = Lock()
    classification_failed = False
    classification_timed_out = False
    timeout = httpx.Timeout(20.0)
    try:
        with httpx.Client(timeout=timeout) as http_client:
            hn = HackerNewsClient(http_client)
            click.echo(
                "Starting Hacker News scan: "
                f"limit={limit}, min_points={min_points}, min_comments={min_comments}, "
                f"max_comment_depth={max_comment_depth}, "
                f"min_comment_descendants={min_comment_descendants}, "
                f"classify_topic={classify_topic}, story_concurrency={story_concurrency}."
            )
            story_ids = hn.top_story_ids()[:limit]
            saved_categories = get_category_assignments(database_url, story_ids) if classifier else {}
            click.echo(f"Received {len(story_ids)} top-story ID(s); fetching story metadata.")

            @traced_operation("ingestion_story")
            def collect_story(position: int, story_id: int) -> dict[str, Any] | None:
                nonlocal examined, detected, filtered, skipped, classification_failed
                nonlocal classification_timed_out
                prefix = f"[{position}/{len(story_ids)}]"
                click.echo(f"{prefix} Fetching story {story_id}.")
                with counter_lock:
                    examined += 1
                story = hn.item(story_id)
                if story is None or story.get("type") != "story" or story.get("dead"):
                    with counter_lock:
                        skipped += 1
                    click.echo(f"{prefix} Skipped: unavailable, non-story, or dead item.")
                    return None

                with counter_lock:
                    detected += 1
                title = story.get("title", "")
                score = story.get("score", 0)
                descendants = story.get("descendants", 0)
                classification = None
                if classifier is not None:
                    classification = reusable_category(saved_categories.get(story_id), title, classifier.model)
                    decision = None
                    if classification is None:
                        # Serialize admission too, so waiting workers see the open circuit.
                        with classification_lock:
                            if classification_failed:
                                return None
                            if classification_timed_out:
                                with counter_lock:
                                    skipped += 1
                                click.echo(
                                    f"{prefix} Skipped story {story_id}: topic classifier "
                                    "circuit is open for this scan; will retry on a future scan."
                                )
                                return None
                            try:
                                decision = classifier.classify(title)
                            except httpx.TimeoutException as error:
                                # Spending another full timeout on each queued title can
                                # exceed Modal's job deadline. Cached stories may continue.
                                classification_timed_out = True
                                report_error(
                                    error, operation="classification", handled=True,
                                    story_id=story_id, model=classifier.model,
                                    run_id=str(run_id), action="open_classification_circuit",
                                )
                                with counter_lock:
                                    skipped += 1
                                click.echo(
                                    f"{prefix} Skipped story {story_id}: topic classification "
                                    "timed out; circuit opened for this scan."
                                )
                                return None
                            except Exception:
                                classification_failed = True
                                raise
                    click.echo(
                        f"{prefix} Topic classification: "
                        f"{classification['category'] + ' (cached)' if classification else decision.model_dump()}."
                    )
                    if decision is not None and not decision.relevant:
                        with counter_lock:
                            filtered += 1
                        click.echo(f"{prefix} Filtered {title!r}: not relevant to the AI news feed.")
                        return None
                    if decision is not None:
                        classification = category_metadata(title, decision.category, classifier.model)

                filter_failures: list[str] = []
                if not title_matches(title, title_words):
                    filter_failures.append("title does not match")
                if descendants < min_comments:
                    filter_failures.append(f"comments={descendants} < {min_comments}")
                if score < min_points:
                    filter_failures.append(f"points={score} < {min_points}")
                if filter_failures:
                    with counter_lock:
                        filtered += 1
                    click.echo(f"{prefix} Filtered {title!r}: {', '.join(filter_failures)}.")
                    return None

                click.echo(
                    f"{prefix} Matched {title!r} "
                    f"({score} points, {descendants} comments); fetching comments."
                )

                def report_comment_progress(processed: int, pending: int) -> None:
                    click.echo(
                        f"{prefix} Comment traversal: processed={processed}, pending={pending}."
                    )

                comments = hn.thread_comments(
                    story,
                    max_comment_depth,
                    on_progress=report_comment_progress,
                )
                retained_comments = retain_comments_with_descendants(
                    comments, min_comment_descendants
                )
                click.echo(
                    f"{prefix} Collected {len(comments)} comment item(s); retained "
                    f"{len(retained_comments)} after subtree filtering."
                )
                return database_row(
                    story,
                    raw_thread_contents(story, retained_comments),
                    top_story_rank=position,
                    max_comment_depth=max_comment_depth,
                    classification=classification,
                )

            # Keep at most story_concurrency tasks in flight. Drain failures without
            # scheduling more; the HTTP client stays open until all workers finish.
            stories = iter(enumerate(story_ids, start=1))
            failure: Exception | None = None
            with ThreadPoolExecutor(max_workers=story_concurrency) as executor:
                pending = set()

                def submit_next() -> None:
                    entry = next(stories, None)
                    if entry is not None:
                        pending.add(executor.submit(copy_context().run, collect_story, *entry))

                for _ in range(story_concurrency):
                    submit_next()
                while pending:
                    completed, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in completed:
                        try:
                            row = future.result()
                        except Exception as error:
                            if failure is None:
                                failure = error
                        else:
                            if row is not None:
                                rows.append(row)
                    if failure is None:
                        for _ in completed:
                            submit_next()
                if failure is not None:
                    raise failure

            # Completion order must never change HN ranking or persistence order.
            rows.sort(key=lambda row: row["top_story_rank"])

        click.echo(
            "Scan complete: "
            f"detected={detected}, filtered={filtered}, skipped={skipped}, matched={len(rows)}."
        )
        click.echo(f"Writing {len(rows)} matched thread(s) and their snapshots to Supabase.")
        stored, snapshots_inserted = store_threads_and_snapshots(database_url, run_id, rows)
    except Exception as error:
        finish_ingestion_run(
            database_url,
            run_id,
            status="failed",
            stories_examined=examined,
            threads_matched=len(rows),
            snapshots_inserted=snapshots_inserted,
            error=str(error),
        )
        raise
    else:
        finish_ingestion_run(
            database_url,
            run_id,
            status="succeeded",
            stories_examined=examined,
            threads_matched=len(rows),
            snapshots_inserted=snapshots_inserted,
        )
        click.echo(
            f"Run {run_id} completed: stored={stored}, "
            f"snapshots_inserted={snapshots_inserted}."
        )
        status = "succeeded"
    finally:
        elapsed = perf_counter() - started
        logging.getLogger("hn_trending").info(json.dumps({
            "event": "ingestion_completed", "run_id": str(run_id), "status": status,
            "examined": examined, "matched": len(rows), "snapshots_inserted": snapshots_inserted,
            "concurrency": story_concurrency, "elapsed_seconds": round(elapsed, 3),
            "items_per_minute": round(examined * 60 / elapsed, 3) if elapsed else 0,
        }))


if __name__ == "__main__":  # pragma: no cover
    main()
