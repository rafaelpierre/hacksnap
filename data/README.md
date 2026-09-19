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
  --max-comment-depth 5
```

At least one `--title-word` value must occur in a title, without regard to case.
Stories are selected from the first `--limit` (default: 100) IDs returned by the official
top-stories endpoint. Direct comments are depth 1; use depth 0 to persist only
the story payload. The default maximum comment depth is 5.
`full_raw_text_contents` stores a JSON document containing the raw official API
payload for the story plus every retrieved comment and its depth.
Use `--min-comment-descendants` to retain only comments with at least that many
descendants inside the fetched depth, together with their ancestor comments for
context. The official API has no comment vote-score field; descendant counts are
therefore the available API-only signal. A value of `0` (the CLI default) retains
every fetched comment.

For a less brittle topic gate, use `--classify-topic`. It calls DeepSeek V4.1 Flash
through your Modal endpoint with the title only. This high-recall first-pass filter retains
AI, ML research, LLM, agent, AI-security, and AI-impact stories, including indirect model
signals such as parameter counts and compression, with model-name hints for Astra,
Fable, and Mythos. It favors inclusion when AI signals are ambiguous, accepting some
false positives to avoid losing AI stories with sparse titles. Product launches and
coding-workflow changes alone do not establish AI relevance. Clearly unrelated
technology is excluded. Set `MODAL_LLM_API_KEY`. `MODAL_LLM_BASE_URL` defaults to
`https://rafaelpierre--ep-deepseek-v4-1-flash-server.us-west.modal.direct/v1`
and `MODAL_LLM_MODEL` defaults to `deepseek-ai/DeepSeek-V4.1-Flash`.
The endpoint receives a strict Pydantic-derived JSON schema with one field,
`relevant: bool`. Incomplete responses and invalid decisions fail the run. A valid decision can
still misclassify a story because the classifier sees only its title.
The current-thread table also records each story's latest HN `points` and total
`comment_count` values for fast filtering and display.

The command upserts by `hn_id`, so it is safe to run on a schedule. It refreshes
the story data and raw contents while retaining the original `date_added` value.
Every invocation also creates an `hn_ingestion_runs` record. Each selected thread
is written to the current-thread table and to `hn_thread_snapshots` in one
transaction; identical raw content is deduplicated per thread. The run records
the filters, examined and matched counts, terminal status, and number of newly
inserted snapshots. `hn_thread_summaries` is intentionally populated later by a
separate LLM worker, which should read a snapshot (not the mutable current-thread
row) as its source.
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

## Scheduled ingestion on Modal

[modal_app.py](modal_app.py) deploys the `hn-ingestion` app. Its `ingest` function
runs every 20 minutes at :17, :37, and :57 from 08:00 through 23:59 UTC. It preserves the previous filters:
20 top stories, at least 20 points and 20 comments, comment depth 5, and at least
3 descendants per retained comment (plus ancestors).

It reuses `SUPABASE_PASSWORD` and `MODAL_LLM_API_KEY` from the existing `hacksnap`
Modal Secret. The scheduled function explicitly selects the DeepSeek endpoint and
model above, independently of the enrichment app's model settings.

```sh
cd data
uv sync --locked
uv run pytest
# One-off verification before activating the schedule:
uv run modal run modal_app.py::ingest
uv run modal deploy modal_app.py
```

One container processes one invocation at a time, with a 25-minute timeout.
Runs keep the existing database run history, failure reporting, and snapshot
counts. View logs and trigger manual runs from the Modal app dashboard. Redeploy
after source changes; GitHub no longer runs ingestion. Database migrations remain
in the separate GitHub Actions schema workflow.

For production cutover, verify a one-off Modal run, disable the old workflow with
`gh workflow disable hn-ingestion.yml`, then deploy the Modal schedule. The old
workflow file is removed from this repository to prevent duplicate schedules once
these changes are merged. To roll back, first stop the `hn-ingestion` Modal app,
then restore and enable the old workflow and its required credentials.
