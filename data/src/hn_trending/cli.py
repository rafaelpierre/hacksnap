"""Click entry point for collecting Hacker News trending threads."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import quote

import click
import httpx

from hn_trending.client import HackerNewsClient
from hn_trending.storage import database_row, store_threads


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
    limit: int,
) -> None:
    """Fetch filtered top HN stories and save their raw thread contents to Supabase."""
    timeout = httpx.Timeout(20.0)
    with httpx.Client(timeout=timeout) as http_client:
        hn = HackerNewsClient(http_client)
        rows: list[dict[str, Any]] = []
        for story_id in hn.top_story_ids()[:limit]:
            story = hn.item(story_id)
            if story is None or story.get("type") != "story" or story.get("dead"):
                continue
            if not title_matches(story.get("title", ""), title_words):
                continue
            if story.get("descendants", 0) < min_comments:
                continue
            if story.get("score", 0) < min_points:
                continue

            comments = hn.thread_comments(story, max_comment_depth)
            rows.append(database_row(story, raw_thread_contents(story, comments)))

    stored = store_threads(resolve_database_url(), rows)
    click.echo(f"Stored {stored} Hacker News thread(s).")


if __name__ == "__main__":  # pragma: no cover
    main()
