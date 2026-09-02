from hn_threads_mcp.database import MAX_LIMIT, clamp_limit


def test_clamp_limit_bounds_results() -> None:
    assert clamp_limit(None) == 10
    assert clamp_limit(0) == 1
    assert clamp_limit(MAX_LIMIT + 1) == MAX_LIMIT
