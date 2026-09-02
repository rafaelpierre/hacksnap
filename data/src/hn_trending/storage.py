"""Supabase/PostgreSQL persistence."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Any
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb


UPSERT_THREAD = """
INSERT INTO hacker_news_threads
    (hn_id, title, url, full_raw_text_contents, date_published, date_added, author,
     points, comment_count)
VALUES
    (%(hn_id)s, %(title)s, %(url)s, %(full_raw_text_contents)s,
     %(date_published)s, %(date_added)s, %(author)s, %(points)s, %(comment_count)s)
ON CONFLICT (hn_id) DO UPDATE SET
    title = EXCLUDED.title,
    url = EXCLUDED.url,
    full_raw_text_contents = EXCLUDED.full_raw_text_contents,
    date_published = EXCLUDED.date_published,
    author = EXCLUDED.author,
    points = EXCLUDED.points,
    comment_count = EXCLUDED.comment_count
"""

INSERT_INGESTION_RUN = """
INSERT INTO hn_ingestion_runs (run_id, status, filters)
VALUES (%s, 'running', %s)
"""

FINISH_INGESTION_RUN = """
UPDATE hn_ingestion_runs
SET finished_at = CURRENT_TIMESTAMP,
    status = %s,
    stories_examined = %s,
    threads_matched = %s,
    snapshots_inserted = %s,
    error = %s
WHERE run_id = %s
"""

INSERT_SNAPSHOT = """
INSERT INTO hn_thread_snapshots
    (run_id, hn_id, raw_payload, content_hash, score, descendants,
     top_story_rank, max_comment_depth)
VALUES
    (%(run_id)s, %(hn_id)s, %(raw_payload)s, %(content_hash)s, %(score)s,
     %(descendants)s, %(top_story_rank)s, %(max_comment_depth)s)
ON CONFLICT (hn_id, content_hash) DO NOTHING
RETURNING snapshot_id
"""


def start_ingestion_run(database_url: str, filters: dict[str, Any]) -> UUID:
    """Create a running ingestion record and return its identifier."""
    run_id = uuid4()
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(INSERT_INGESTION_RUN, (run_id, Jsonb(filters)))
        connection.commit()
    return run_id


def finish_ingestion_run(
    database_url: str,
    run_id: UUID,
    *,
    status: str,
    stories_examined: int,
    threads_matched: int,
    snapshots_inserted: int,
    error: str | None = None,
) -> None:
    """Record the terminal outcome and counters for an ingestion run."""
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                FINISH_INGESTION_RUN,
                (
                    status,
                    stories_examined,
                    threads_matched,
                    snapshots_inserted,
                    error,
                    run_id,
                ),
            )
        connection.commit()


def snapshot_row(row: dict[str, Any], run_id: UUID) -> dict[str, Any]:
    """Map one current-thread row to its immutable snapshot representation."""
    raw_contents = row["full_raw_text_contents"]
    return {
        "run_id": run_id,
        "hn_id": row["hn_id"],
        "raw_payload": Jsonb(json.loads(raw_contents)),
        "content_hash": hashlib.sha256(raw_contents.encode()).hexdigest(),
        "score": row["points"],
        "descendants": row["comment_count"],
        "top_story_rank": row["top_story_rank"],
        "max_comment_depth": row["max_comment_depth"],
    }


def store_threads_and_snapshots(
    database_url: str, run_id: UUID, rows: list[dict[str, Any]]
) -> tuple[int, int]:
    """Atomically upsert current rows and insert new content snapshots."""
    if not rows:
        return 0, 0

    snapshots_inserted = 0
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for row in rows:
                cursor.execute(UPSERT_THREAD, row)
                cursor.execute(INSERT_SNAPSHOT, snapshot_row(row, run_id))
                snapshots_inserted += int(cursor.fetchone() is not None)
        connection.commit()
    return len(rows), snapshots_inserted


def database_row(
    story: dict[str, Any],
    raw_contents: str,
    *,
    top_story_rank: int,
    max_comment_depth: int,
) -> dict[str, Any]:
    """Map an official HN story payload to the database schema."""
    published = datetime.fromtimestamp(story["time"], tz=timezone.utc)
    fallback_url = f"https://news.ycombinator.com/item?id={story['id']}"
    return {
        "hn_id": story["id"],
        "title": story["title"],
        "url": story.get("url") or fallback_url,
        "full_raw_text_contents": raw_contents,
        "date_published": published,
        "date_added": datetime.now(timezone.utc),
        "author": story.get("by"),
        "points": story.get("score", 0),
        "comment_count": story.get("descendants", 0),
        "top_story_rank": top_story_rank,
        "max_comment_depth": max_comment_depth,
    }
