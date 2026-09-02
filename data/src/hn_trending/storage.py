"""Supabase/PostgreSQL persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import psycopg


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


def store_threads(database_url: str, rows: list[dict[str, Any]]) -> int:
    """Upsert rows and return the number submitted to PostgreSQL."""
    if not rows:
        return 0

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.executemany(UPSERT_THREAD, rows)
        connection.commit()
    return len(rows)


def database_row(story: dict[str, Any], raw_contents: str) -> dict[str, Any]:
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
    }
