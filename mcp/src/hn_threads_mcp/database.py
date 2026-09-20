"""Connection and query helpers for the Hacker News MCP server."""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import date
from typing import Any, Iterator
from urllib.parse import quote

import psycopg
from psycopg.rows import dict_row


DEFAULT_LIMIT = 10
MAX_LIMIT = 25
MAX_RETURNED_COMMENTS = 80


def database_url() -> str:
    """Return an explicitly supplied URL or the project's TLS pooler URL.

    HN_MCP_DATABASE_URL is intended for a dedicated database role with SELECT-only
    grants. SUPABASE_PASSWORD preserves compatibility with the existing collector.
    """
    explicit_url = os.environ.get("HN_MCP_DATABASE_URL")
    if explicit_url:
        return explicit_url

    password = os.environ.get("SUPABASE_PASSWORD")
    if not password:
        raise RuntimeError(
            "Set HN_MCP_DATABASE_URL (recommended) or SUPABASE_PASSWORD before "
            "starting the Hacker News MCP server."
        )
    return (
        "postgresql://postgres.tbihbssiluihmnseuknk:"
        f"{quote(password, safe='')}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
        "?sslmode=require"
    )


@contextmanager
def read_only_cursor() -> Iterator[psycopg.Cursor[dict[str, Any]]]:
    """Yield a cursor in a transaction that PostgreSQL will reject writes from."""
    with psycopg.connect(database_url(), row_factory=dict_row) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute("SET LOCAL statement_timeout = '10s'")
                yield cursor


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(limit, MAX_LIMIT))


def search_threads(
    query: str | None,
    limit: int | None,
    min_points: int,
    min_comments: int,
    published_after: date | None,
) -> list[dict[str, Any]]:
    """Search title and persisted payload text with fixed, parameterized SQL."""
    normalized_query = (query or "").strip()
    where_clauses = ["points >= %(min_points)s", "comment_count >= %(min_comments)s"]
    parameters: dict[str, Any] = {
        "min_points": max(0, min_points),
        "min_comments": max(0, min_comments),
        "limit": clamp_limit(limit),
    }
    if normalized_query:
        where_clauses.append(
            "(title ILIKE %(pattern)s OR full_raw_text_contents ILIKE %(pattern)s)"
        )
        parameters["pattern"] = f"%{normalized_query}%"
    if published_after:
        where_clauses.append("date_published >= %(published_after)s")
        parameters["published_after"] = published_after

    sql = f"""
        SELECT hn_id, title, url, author, date_published, date_added, points, comment_count
        FROM hacker_news_threads LEFT JOIN hn_thread_contents USING (hn_id)
        WHERE {' AND '.join(where_clauses)}
        ORDER BY
            CASE WHEN %(pattern)s::text IS NULL THEN 0
                 WHEN title ILIKE %(pattern)s THEN 1 ELSE 2 END,
            points DESC,
            date_published DESC
        LIMIT %(limit)s
    """
    # PostgreSQL still needs a bound value for the ranking expression when a
    # query is omitted. NULL ensures it does not affect the sort order.
    parameters.setdefault("pattern", None)
    with read_only_cursor() as cursor:
        cursor.execute(sql, parameters)
        return list(cursor.fetchall())


def get_thread(hn_id: int) -> dict[str, Any] | None:
    with read_only_cursor() as cursor:
        cursor.execute(
            """
            SELECT hn_id, title, url, author, date_published, date_added, points,
                   comment_count, full_raw_text_contents
            FROM hacker_news_threads LEFT JOIN hn_thread_contents USING (hn_id)
            WHERE hn_id = %s
            """,
            (hn_id,),
        )
        return cursor.fetchone()


def list_snapshots(hn_id: int, limit: int | None) -> list[dict[str, Any]]:
    with read_only_cursor() as cursor:
        cursor.execute(
            """
            SELECT snapshot_id, hn_id, run_id, score, descendants, top_story_rank,
                   max_comment_depth, observed_at
            FROM hn_thread_snapshots
            WHERE hn_id = %s
            ORDER BY observed_at DESC
            LIMIT %s
            """,
            (hn_id, clamp_limit(limit)),
        )
        return list(cursor.fetchall())
