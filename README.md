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

See [Spamhaus → Cloudflare setup](docs/spamhaus-cloudflare.md) for the weekly
malicious-network list refresh workflow.

See [Scanner tax Worker setup](cloudflare/scanner-tax/README.md) for the HTTP 402
response to secret-file and WordPress probes at the Cloudflare edge.

Apply migration `0004_hacksnap` before running the updated collector. Configure
the `hacksnap` Modal Secret before deploying its schedule. The website uses
server-only database credentials; no service-role key is sent to browsers.

## Continuous integration

Pull requests and pushes to `main` run only the workflows affected by their
changed paths. Each workflow also runs when its own YAML file changes.

| Workflow | Related paths | Checks |
| --- | --- | --- |
| Hacksnap worker | `hacksnap/**`, excluding `hacksnap/web/**`, plus worker deployment helpers/tests | Ruff lint and pytest/import checks in parallel |
| Ingestion | `data/**`, plus `hacksnap/web/lib/categories.ts` used by the category consistency test | pytest |
| Frontend | `hacksnap/web/**`, shared `hacksnap/fixtures/**`, and migration `0012_discussion_analysis.py` used by the projection tests | Oxlint, Oxfmt, Jest, and typecheck/build in four parallel jobs |
| MCP | `mcp/**` | pytest |

Schema validation, scanner-tax, and Spamhaus keep their existing scoped workflows.
Matrix jobs use `fail-fast: false` so a lint or formatting failure does not cancel
the test results. Ingestion and MCP currently have no configured lint/format checks.
Main pushes keep worker checks for tests, fixtures and documentation changes.
Production-path changes additionally enable automatic Modal deployment; manual
**Hacksnap** runs can also deploy. Both require worker, ingestion and frontend checks
before the reusable Supabase schema workflow applies pending migrations, followed
by Modal deployment. Frontend and ingestion workflows are reusable so this deployment
uses the same checks as pull requests.

If branch protection requires the former `test` check, update its required checks
to match the new names. Path-filtered workflows do not report checks for unrelated
changes; do not require every project check unconditionally.
