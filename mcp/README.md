# Hacker News Threads MCP

This local, stdio MCP server provides Codex with read-only access to the Hacker
News threads collected by the sibling `data/` project. It exposes:

- `search_hn_threads` — search persisted story titles and captured payloads, with
  score, comment-count, and publication-date filters.
- `get_hn_thread` — retrieve one story and its saved comments for source-backed
  article brainstorming.
- `list_hn_thread_snapshots` — inspect historical immutable observations.

The server does not expose arbitrary SQL or write operations. Each request uses a
PostgreSQL read-only transaction and a 10-second statement timeout.

## Setup

Install the isolated runtime once:

```sh
cd mcp
uv sync
```

`run-server.sh` loads the repository root `.env`, so the existing
`SUPABASE_PASSWORD` value works without placing secrets in Codex configuration.
For least privilege, instead set `HN_MCP_DATABASE_URL` in `.env` to a TLS
connection URL for a dedicated database role granted only `SELECT` on:
`hacker_news_threads` and `hn_thread_snapshots`.

This repository includes the following project-scoped `.codex/config.toml` entry:

```toml
[mcp_servers.hacker_news_threads]
command = "/Users/rafaelpierre/projects/lighthouse-hacker-news/mcp/run-server.sh"
cwd = "/Users/rafaelpierre/projects/lighthouse-hacker-news/mcp"
startup_timeout_sec = 30
```

Restart Codex or start a new task after saving the configuration. Then ask, for
example: “Find 3 persisted HN threads about agent reliability and propose article
angles that synthesize the strongest disagreements.”

## Development checks

```sh
cd mcp
uv run pytest
```

After Alembic migration 0008, the read-only role also needs SELECT and equivalent
RLS access on `hn_thread_contents`. Metadata remains searchable after raw content
is purged. `get_hn_thread` returns `found: true`, `comments_available: false`,
`contents_status: "not_retained"` and a null stored-comment count when content is
absent. It does not reconstruct or automatically refetch expired comments.
