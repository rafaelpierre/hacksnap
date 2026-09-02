from uuid import uuid4

import pytest

from hn_trending.client import HackerNewsClient
from hn_trending.cli import resolve_database_url, title_matches
from hn_trending.storage import database_row, snapshot_row


def test_title_words_are_case_insensitive_and_match_any_word() -> None:
    assert title_matches("AI engineering at scale", ("ai", "ENGINEERING"))
    assert title_matches("AI research", ("ai", "engineering"))
    assert not title_matches("Database research", ("ai", "engineering"))


def test_database_url_resolution_uses_the_ipv4_pooler(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PASSWORD", "a password/with symbols")
    database_url = resolve_database_url()
    assert "a%20password%2Fwith%20symbols" in database_url
    assert "aws-1-eu-west-1.pooler.supabase.com:5432" in database_url
    assert database_url.endswith("?sslmode=require")


def test_comment_traversal_reports_progress() -> None:
    class StubHackerNewsClient(HackerNewsClient):
        def __init__(self) -> None:
            pass

        def item(self, item_id: int):
            return {"id": item_id, "kids": []}

    progress: list[tuple[int, int]] = []
    comments = StubHackerNewsClient().thread_comments(
        {"kids": [1, 2]},
        max_depth=1,
        on_progress=lambda processed, pending: progress.append((processed, pending)),
    )

    assert [comment["item"]["id"] for comment in comments] == [1, 2]
    assert progress == [(1, 1)]


def test_database_row_contains_current_hacker_news_metrics() -> None:
    row = database_row(
        {
            "id": 1,
            "title": "Example story",
            "time": 1,
            "score": 42,
            "descendants": 24,
        },
        "{}",
        top_story_rank=1,
        max_comment_depth=2,
    )

    assert row["points"] == 42
    assert row["comment_count"] == 24
    assert row["top_story_rank"] == 1
    assert row["max_comment_depth"] == 2


def test_snapshot_row_has_stable_hash_and_parsed_payload() -> None:
    row = {
        "hn_id": 1,
        "full_raw_text_contents": '{"story": {"id": 1}}',
        "points": 42,
        "comment_count": 24,
        "top_story_rank": 3,
        "max_comment_depth": 1,
    }

    snapshot = snapshot_row(row, run_id=uuid4())

    assert snapshot["content_hash"] == "b4dc5a7020c95dfe03bf62ab0dd3dce93dc6da8664d61282e53db36451cef072"
    assert snapshot["raw_payload"].obj == {"story": {"id": 1}}
    assert snapshot["top_story_rank"] == 3
