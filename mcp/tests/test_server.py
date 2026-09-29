"""Exercise tool discovery and calls through the MCP SDK."""

import asyncio
import sys
from datetime import date

from mcp import Client, StdioServerParameters

from hn_threads_mcp import server


def test_mcp_tools(monkeypatch):
    def search(query, limit, min_points, min_comments, published_after):
        assert (query, limit, min_points, min_comments, published_after) == (
            "agents", 10, 0, 0, date(2026, 9, 1),
        )
        return [{"hn_id": 1, "title": "Agents"}]

    monkeypatch.setattr(server, "search_threads", search)
    monkeypatch.setattr(server, "get_thread", lambda hn_id: None)
    monkeypatch.setattr(server, "list_snapshots", lambda hn_id, limit: [])

    async def exercise():
        async with Client(server.mcp, mode="legacy") as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == {
                "search_hn_threads", "get_hn_thread", "list_hn_thread_snapshots",
            }
            search_result = await client.call_tool("search_hn_threads", {
                "query": "agents", "published_after": "2026-09-01",
            })
            assert not search_result.is_error
            assert search_result.structured_content == {
                "result": [{"hn_id": 1, "title": "Agents"}],
            }
            thread = await client.call_tool("get_hn_thread", {"hn_id": 1})
            assert not thread.is_error
            assert thread.structured_content == {"found": False, "hn_id": 1}
            snapshots = await client.call_tool("list_hn_thread_snapshots", {"hn_id": 1})
            assert not snapshots.is_error
            assert snapshots.structured_content == {"result": []}

    asyncio.run(exercise())


def test_stdio_startup():
    async def exercise():
        async with Client(StdioServerParameters(
            command=sys.executable,
            args=["-m", "hn_threads_mcp.server"],
        ), mode="legacy") as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == {
                "search_hn_threads", "get_hn_thread", "list_hn_thread_snapshots",
            }

    asyncio.run(exercise())
