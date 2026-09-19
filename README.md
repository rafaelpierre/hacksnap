# Hacksnap

The top AI stories from Hacker News, with separate article and discussion briefs.

- `data/`: Modal HN ingestion with DeepSeek Flash hourly and Alembic migrations.
- `mcp/`: existing read-only tools for stored HN threads.
- `hacksnap/`: Modal enrichment every four hours using Kestrel and a Modal-hosted model, plus a Next.js UI.

The leaderboard prefers stories first added within the last 24 hours, fills
remaining slots with older AI stories, and ranks the selected ten by points
descending. A quiet ingestion run does not empty it.

See [Hacksnap setup, tests and deployment](hacksnap/README.md),
[ingestion documentation](data/README.md), and [MCP documentation](mcp/README.md).

Apply migration `0004_hacksnap` before running the updated collector. Configure
the `hacksnap` Modal Secret before deploying its schedule. The website uses
server-only database credentials; no service-role key is sent to browsers.
