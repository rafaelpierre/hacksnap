# Hacker News trending collector

A scheduled, API-only collector for Hacker News top stories. It uses the official
Hacker News Firebase API (`/v0/topstories.json` and `/v0/item/<id>.json`) and does
not scrape the Hacker News website.

## Setup

```sh
cd data
cp .env.example .env
# Edit .env and replace [YOUR-PASSWORD]. SUPABASE_PASSWORD is sufficient.
uv sync
set -a; source ../.env; set +a
uv run alembic upgrade head
```

Load the environment file before running the command (for example,
`set -a; source .env; set +a` in zsh/bash):

```sh
uv run hn-trending \
  --title-word ai \
  --title-word engineering \
  --min-comments 20 \
  --min-points 100 \
  --max-comment-depth 3
```

At least one `--title-word` value must occur in a title, without regard to case.
Stories are selected from the first `--limit` (default: 100) IDs returned by the official
top-stories endpoint. Direct comments are depth 1; use depth 0 to persist only
the story payload. `full_raw_text_contents` stores a JSON document containing the
raw official API payload for the story plus every retrieved comment and its depth.

The command upserts by `hn_id`, so it is safe to run on a schedule. It refreshes
the story data and raw contents while retaining the original `date_added` value.
The command always connects through this project's IPv4-capable Supabase pooler
with TLS. Its only required database setting is `SUPABASE_PASSWORD`.

## Database migrations

Alembic is the single source of truth for the database schema. Run migrations as
a deployment step before the scheduled collector, never as part of each collector
run:

```sh
set -a; source ../.env; set +a
uv run alembic upgrade head
```

The existing production `hacker_news_threads` table was created before Alembic.
On that database only, first record the baseline without re-creating the table:

```sh
uv run alembic stamp 0001_initial_threads
uv run alembic upgrade head
```

New databases use `uv run alembic upgrade head` directly. The history contains
the current-thread table, immutable ingestion runs and thread snapshots, and
versioned LLM summary records. These tables are private by default: RLS is
enabled and no Data API policies are created.

## GitHub Actions

The [schema workflow](../.github/workflows/supabase-schema.yml) validates changes
to migrations on pull requests. Once a matching change reaches `main`, it applies
the pending migrations through the IPv4 pooler. Configure `SUPABASE_PASSWORD` as
a GitHub Actions secret, preferably scoped to the `supabase-production`
environment and protected by a required reviewer.

The pooler hostname, port, database, and user are fixed in the application, so a
separate connection-string secret is not needed. Never add a password-bearing
connection URL to repository files or workflow logs.

## Hourly Hacker News ingestion

The [ingestion workflow](../.github/workflows/hn-ingestion.yml) fetches the
latest 20 HN top stories every hour at minute 17 UTC, then persists the matching
threads with at least 20 points and 20 comments through the IPv4 pooler. The
offset avoids GitHub Actions' busiest top-of-hour period. It can also be started from the GitHub Actions page with
**Run workflow**. Its job log ends with the number of stored threads.
It also reports each story being fetched, every filter decision, comment traversal
progress, and the final detected/filtered/matched totals.

It requires the same `SUPABASE_PASSWORD` GitHub Actions secret as the migration
workflow. Only one ingestion run may write at a time; queued hourly or manual
runs wait instead of overlapping.
