from hn_threads_mcp.database import MAX_LIMIT, clamp_limit


def test_clamp_limit_bounds_results() -> None:
    assert clamp_limit(None) == 10
    assert clamp_limit(0) == 1
    assert clamp_limit(MAX_LIMIT + 1) == MAX_LIMIT


def test_get_thread_reports_unretained_contents(monkeypatch):
    from hn_threads_mcp import server
    monkeypatch.setattr(server, "get_thread", lambda _: {
        "hn_id": 1, "title": "Preserved", "full_raw_text_contents": None,
    })
    result = server.get_hn_thread(1)
    assert result["found"] is True
    assert result["comments_available"] is False
    assert result["contents_status"] == "not_retained"
    assert result["stored_comment_count"] is None
    assert "comments" not in result
    assert result["thread"]["title"] == "Preserved"
