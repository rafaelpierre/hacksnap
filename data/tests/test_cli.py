import pytest

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
