import pytest

from hn_trending.client import HackerNewsClient
from hn_trending.cli import resolve_database_url, title_matches


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
