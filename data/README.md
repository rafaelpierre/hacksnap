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
`hn_thread_contents.full_raw_text_contents` stores a JSON document containing the raw official API
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
Classification requests have a minimum five-second pause after the previous response.
HTTP 429 responses retry up to four times with 15/30/60/120-second backoff,
honoring longer `Retry-After` values (seconds or HTTP dates). A server cooldown
above 120 seconds fails the run instead of retrying too early. Each retry is logged;
other HTTP errors and invalid model output still fail immediately.
The current-thread table also records each story's latest HN `points` and total
`comment_count` values for fast filtering and display.

The command upserts by `hn_id`, so it is safe to run on a schedule. It refreshes
the story metadata while retaining the original `date_added` value. Raw contents
are retained only under the policy described below.
Every invocation also creates an `hn_ingestion_runs` record. Each selected thread
is written to the metadata/content tables and to `hn_thread_snapshots` in one
transaction; identical raw content is deduplicated per thread. The run records
the filters, examined and matched counts, terminal status, and number of newly
inserted snapshots. `hn_thread_summaries` is intentionally populated later by a
separate LLM worker, which must check that a snapshot still has `raw_payload` before using it
as its source.
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
runs hourly at :17 from 08:17 through 23:17 UTC. It preserves the previous filters:
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

## Source-content retention (migration 0008)

`hn_items` is the permanent HN identity registry. All story-ID foreign keys now
reference it, including `hacker_news_threads`, which retains only metadata.
`hn_thread_contents` holds the optional current raw story/comment document and
its deterministic SHA-256 hash. Snapshot metadata remains durable; snapshot
`raw_payload` is nullable and disposable. Deleting content never cascades into
summaries, rank history, fetch failures or snapshot summary records.

The hash covers story title/URL/text and comment IDs, parents, authors, text,
deletion flags and depths, sorted by comment ID. Scores and API comment ordering
do not affect it. Ingestion still fetches comments to detect changes. A committed
summary stores `summarized_content_hash` independently of disposable content.
Failed inference does not advance that hash. A changed payload is retained for
retry; unchanged article-summary content is not stored again. Once the original
`date_added` is older than seven days, ingestion stores metadata only, even if
comments change. Changing a model/prompt alone does not restore purged inputs;
regeneration requires an explicit refetch/retention override.

The enrichment job calls `cleanup_hn_contents(500)` after each refresh. Each call
deletes at most 500 current payloads and clears at most 500 snapshot payloads.
Current content is eligible when its hash matches a saved **article** summary,
or its story was first stored more than seven days ago. Changed content awaiting
summarization survives until that age cutoff. Snapshot payloads are eligible when
an article summary exists, the story is older than seven days, or the snapshot
itself is older than seven days. Discussion-only summaries do not trigger early
cleanup. Metadata, IDs and saved summaries are retained indefinitely.

For a backlog, an operator can run `SELECT * FROM cleanup_hn_contents(500);`
repeatedly, committing between calls, until both returned counts are zero.
The function uses invoker permissions, bounds batch sizes and skips locked rows;
it is not executable by PUBLIC, anon or authenticated. A dedicated maintenance
role needs explicit function execution and the relevant table privileges/RLS
access. The production jobs currently connect as the database owner.

Deployment: pause ingestion and enrichment; take a backup; apply Alembic 0008;
deploy the updated collector, enrichment worker and MCP; grant the MCP reader
SELECT on `hn_thread_contents` with the same RLS access as its existing private
reads; resume jobs. Existing web queries keep working, and view grants are
preserved. Worker roles other than the owner also need access to `hn_items`,
`hn_thread_contents`, and `hn_source_hash(jsonb)`. The migration backfills current
payloads but does not run cleanup. Existing summary hashes start unknown and are
populated after a successful refresh, never guessed from the latest comments.

Purged inputs cannot be reconstructed, so downgrade requires restoring a backup.
Deleting rows frees reusable space through vacuuming; physical file compaction
is a separate maintenance decision.

Local database regression checks (no production connection):

```sh
SUPABASE_PASSWORD=offline-only uv run alembic upgrade head --sql > /tmp/hn-schema.sql
cd ../hacksnap/web
HACKSNAP_SCHEMA_SQL=/tmp/hn-schema.sql npm run test:db
```
