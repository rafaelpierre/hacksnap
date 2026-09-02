"""Click entry point for collecting Hacker News trending threads."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import quote

import click
import httpx

from hn_trending.client import HackerNewsClient, retain_comments_with_descendants
from hn_trending.storage import (
    database_row,
    finish_ingestion_run,
    start_ingestion_run,
    store_threads_and_snapshots,
)
from hn_trending.topic_filter import TitleTopicClassifier


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
    default=1,
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
    help="Use Amazon Nova Micro on Bedrock to gate titles for practical AI relevance.",
)
@click.option(
    "--limit",
    type=click.IntRange(min=1),
    default=100,
    show_default=True,
    help="Number of top-story IDs to consider from the HN API.",
)
def main(
    title_words: tuple[str, ...],
    min_comments: int,
    min_points: int,
    max_comment_depth: int,
    min_comment_descendants: int,
    classify_topic: bool,
    limit: int,
) -> None:
    """Fetch filtered top HN stories and save their raw thread contents to Supabase."""
    classifier: TitleTopicClassifier | None = None
    if classify_topic:
        bedrock_api_key = os.environ.get("BEDROCK_API_KEY")
        if not bedrock_api_key:
            raise click.UsageError("Set BEDROCK_API_KEY when using --classify-topic.")
        classifier = TitleTopicClassifier(
            bedrock_api_key, region=os.environ.get("BEDROCK_REGION", "eu-west-1")
        )

    database_url = resolve_database_url()
    run_filters = {
        "title_words": list(title_words),
        "min_comments": min_comments,
        "min_points": min_points,
        "max_comment_depth": max_comment_depth,
        "min_comment_descendants": min_comment_descendants,
        "classify_topic": classify_topic,
        "limit": limit,
    }
    run_id = start_ingestion_run(database_url, run_filters)
    click.echo(f"Created ingestion run {run_id}.")

    rows: list[dict[str, Any]] = []
    detected = 0
    filtered = 0
    skipped = 0
    examined = 0
    snapshots_inserted = 0
    timeout = httpx.Timeout(20.0)
    try:
        with httpx.Client(timeout=timeout) as http_client:
            hn = HackerNewsClient(http_client)
            click.echo(
                "Starting Hacker News scan: "
                f"limit={limit}, min_points={min_points}, min_comments={min_comments}, "
                f"max_comment_depth={max_comment_depth}, "
                f"min_comment_descendants={min_comment_descendants}, "
                f"classify_topic={classify_topic}."
            )
            story_ids = hn.top_story_ids()[:limit]
            click.echo(f"Received {len(story_ids)} top-story ID(s); fetching story metadata.")

            for position, story_id in enumerate(story_ids, start=1):
                prefix = f"[{position}/{len(story_ids)}]"
                click.echo(f"{prefix} Fetching story {story_id}.")
                examined += 1
                story = hn.item(story_id)
                if story is None or story.get("type") != "story" or story.get("dead"):
                    skipped += 1
                    click.echo(f"{prefix} Skipped: unavailable, non-story, or dead item.")
                    continue

                detected += 1
                title = story.get("title", "")
                score = story.get("score", 0)
                descendants = story.get("descendants", 0)
                if classifier is not None:
                    decision = classifier.classify(title)
                    click.echo(
                        f"{prefix} Topic classification: include={decision.include}; "
                        f"reason={decision.reason}"
                    )
                    if not decision.include:
                        filtered += 1
                        click.echo(f"{prefix} Filtered {title!r}: not relevant to practical AI.")
                        continue

                filter_failures: list[str] = []
                if not title_matches(title, title_words):
                    filter_failures.append("title does not match")
                if descendants < min_comments:
                    filter_failures.append(f"comments={descendants} < {min_comments}")
                if score < min_points:
                    filter_failures.append(f"points={score} < {min_points}")
                if filter_failures:
                    filtered += 1
                    click.echo(f"{prefix} Filtered {title!r}: {', '.join(filter_failures)}.")
                    continue

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
                rows.append(
                    database_row(
                        story,
                        raw_thread_contents(story, retained_comments),
                        top_story_rank=position,
                        max_comment_depth=max_comment_depth,
                    )
                )

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


if __name__ == "__main__":  # pragma: no cover
    main()
