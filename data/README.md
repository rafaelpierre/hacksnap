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
Stories are processed concurrently with `--story-concurrency` (default: `4`, range:
`1`–`16`). Set it to `1` for sequential ingestion. Each story still traverses its
comments sequentially, keeping the number of simultaneous HN requests bounded by
this setting. Original HN ranks and comment ordering are preserved, and matched
stories are written in rank order after the scan succeeds. If a worker fails,
ingestion stops scheduling new stories, waits for in-flight stories, and records
a failed run without writing the collected threads or snapshots. Examined and
matched counts include the in-flight work that finishes before failure reporting.
`hn_thread_contents.full_raw_text_contents` stores a JSON document containing the raw official API
payload for the story plus every retrieved comment and its depth.
Use `--min-comment-descendants` to retain only comments with at least that many
descendants inside the fetched depth, together with their ancestor comments for
context. The official API has no comment vote-score field; descendant counts are
therefore the available API-only signal. A value of `0` (the CLI default) retains
every fetched comment.

For a less brittle topic gate, use `--classify-topic`. It calls GLM 5.3 Flash NVFP4
through your Modal endpoint with the title only. This high-recall first-pass filter retains
AI, ML research, LLM, agent, AI-security, and AI-impact stories, including indirect model
signals such as parameter counts and compression, with model-name hints for Astra,
Fable, and Mythos. It favors inclusion when AI signals are ambiguous, accepting some
false positives to avoid losing AI stories with sparse titles. Product launches and
coding-workflow changes alone do not establish AI relevance. Clearly unrelated
technology is excluded. Set `MODAL_LLM_API_KEY`. `MODAL_LLM_BASE_URL` defaults to
`https://rafaelpierre--ep-glm-5-3-flash-nvfp4-server.us-west.modal.direct/v1`
and `MODAL_LLM_MODEL` defaults to `nvidia/GLM-5.3-Flash-NVFP4`.
The endpoint receives a strict Pydantic-derived JSON schema with `relevant: bool`
and a primary `category` (null for irrelevant titles). A valid decision can
still misclassify a story because the classifier sees only its title.
Classification requests allow up to 8,192 completion tokens, including reasoning,
and have a minimum five-second pause after the previous response. All story workers
share one classifier: its requests and retries remain serialized so this pause and
rate-limit cooldowns apply across the entire run. Classification can overlap with
other stories' HN requests and comment fetching.
HTTP 429 responses retry up to four times with 15/30/60/120-second backoff,
honoring longer `Retry-After` values (seconds or HTTP dates). A server cooldown
above 120 seconds fails the run instead of retrying too early. Each retry is logged.
Truncated or otherwise unfinished completions fail immediately with the title,
finish reason, token budget, and reported token usage. Other HTTP errors and
invalid model output also fail immediately.
Partial decisions are never accepted or treated as irrelevant titles.
The current-thread table also records each story's latest HN `points` and total
`comment_count` values for fast filtering and display.

The command upserts by `hn_id`, so it is safe to run on a schedule. It refreshes
the story metadata while retaining the original `date_added` and `story_slug` values. Raw contents
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
to migrations on pull requests and matching pushes to `main`. These standalone
push runs validate only. The Hacksnap worker and Deploy ingestion workflows call
this reusable workflow after their validation jobs pass and wait for pending
migrations to be applied before Modal deployment. Manual schema runs on `main` remain available.

All rollout paths use `alembic upgrade head` through the IPv4 pooler, which is a
no-op when the schema is current. They share the production migration concurrency
group and reject stale revisions before database access. A failed migration blocks
the calling worker deployment. Configure `SUPABASE_PASSWORD` as
a GitHub Actions secret, preferably scoped to the `supabase-production`
environment and protected by a required reviewer.

The pooler hostname, port, database, and user are fixed in the application, so a
separate connection-string secret is not needed. Never add a password-bearing
connection URL to repository files or workflow logs.

## Scheduled ingestion on Modal

[modal_app.py](modal_app.py) deploys the `hn-ingestion` app. Its `ingest` function
runs hourly at :17 from 08:17 through 23:17 UTC. It preserves the previous filters:
20 top stories, at least 20 points and 20 comments, comment depth 5, and at least
3 descendants per retained comment (plus ancestors). It processes up to four stories
concurrently within the single scheduled invocation.

It reuses `SUPABASE_PASSWORD` and `MODAL_LLM_API_KEY` from the existing `hacksnap`
Modal Secret. The scheduled function explicitly selects the GLM NVFP4 endpoint and
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

## Story categories

The title classifier predicts one primary category in the same response as AI
relevance: `models_products`, `agents_coding`, `research_evaluation`,
`infrastructure_efficiency`, `safety_privacy`, or `industry_society`. Irrelevant
stories must have a null category. The prompt assigns the main news angle, so a
coding-agent data leak goes under safety/privacy rather than agents/coding.

Migration `0011_categories` stores the category, classifier model, prompt/taxonomy
version, timestamp and title hash on `hacker_news_threads`. Metadata must be
complete or entirely null. The existing content-retention policy does not delete
these fields. Website readers can read the category but not classifier metadata.
An index supports category pages ordered by date added, then story ID.

Scheduled ingestion reuses a saved prediction only when its title hash, model and
version match. Bump `CATEGORY_VERSION` when changing the classification rules.
Unclassified ingestion preserves prior category metadata; older cached predictions
cannot overwrite newer assignments. Backfill updates are conditional on the title
and previous classification timestamp still matching, preventing stale writes.

After applying the migration, redeploy `data/modal_app.py` to update the scheduled
collector. The separate `backfill_app.py` has no schedule and cannot start a second
ingestion timer. Backfill existing titles with its existing Modal Secret:

```sh
cd data
uv run modal run backfill_app.py::backfill_categories --limit 6 --dry-run
uv run modal run backfill_app.py::backfill_categories
```

The backfill only reads titles and category metadata. It treats already stored
stories as admitted to the collection, commits each successful prediction, and
skips current assignments on reruns. It never changes rankings, run membership,
raw content or summaries. An interrupted run can be resumed with the same command.
For a local run with `SUPABASE_PASSWORD` and `MODAL_LLM_API_KEY` loaded, use
`uv run python -m hn_trending.backfill_categories` with optional `--limit` or
`--dry-run`. Apply the migration before deploying either the collector or website.


## New-story URLs (migration 0014)

Migration `0014_story_slugs` adds nullable `hacker_news_threads.story_slug` and
SELECT access for the website reader. Existing rows remain NULL and keep their
numeric public URLs. The updated collector generates a bounded headline slug only
for the INSERT values. Its conflict update deliberately leaves `story_slug`
untouched, including NULL, so neither old stories nor saved new slugs change when
re-ingested or retitled. Duplicate headlines remain distinct through the HN ID suffix.

Deploy the migration and website before the updated collector. The website safely
uses numeric URLs while the new column or its reader grant is unavailable. No
backfill is needed. Avoid downgrading migration 0014 after new URLs are published:
it removes their saved slugs. Rolling back collector code alone preserves them.

The collector tests cover normalization and the no-backfill migration. To also
execute the migration, grants and actual upsert against embedded PostgreSQL, run
from the repository root after installing the frontend dependencies:

```sh
HACKSNAP_TEST_PGLITE_MODULE="$(pwd)/hacksnap/web/node_modules/@electric-sql/pglite/dist/index.js" \
  uv run --directory data pytest
```

## Logfire telemetry

Modal jobs configure Logfire once per container, collect system metrics, and
trace outgoing HTTPX requests beneath a job span. Each invocation flushes
telemetry before returning, including failed jobs. The summary and classification
clients call HTTPX directly, so this uses `logfire.instrument_httpx()` rather than
the OpenAI SDK integration. Both images install `logfire[httpx,system-metrics]`
from their locked dependencies.

Add `LOGFIRE_TOKEN` for the `kestrel/hacksnap` Logfire project to the existing
**hacksnap** Modal Secret shared by these workflows. Redeploy the apps after
adding it. Without a token or local project credentials, remote export is disabled
and jobs can still run. Never put the token in source or the container image.

For local Logfire authentication, run these commands from this Python project:

```sh
uv run logfire --region eu auth
uv run logfire --region eu projects use --org 'kestrel' 'hacksnap'
```

The generated `.logfire/` credentials are ignored by Git. Modal uses the secret's
token and does not need an interactive login. Telemetry is initialized by the
Modal entry points; direct pipeline/CLI execution does not initialize it.

Services are `hacksnap` (summary and image jobs), `hn-ingestion`, and
`hn-category-backfill`. HTTP spans contain request URLs, methods, status, and
latency, with headers and bodies disabled for general HTTP traffic. Inference
calls additionally create LLM spans containing full prompts, completions (including
returned reasoning), model, inference parameters and response schema, finish reasons,
and raw token usage. Input, output, total, cached input, and reasoning token counts
are exposed separately when reported by the endpoint. Cached input supports both
`prompt_tokens_details.cached_tokens` and `prompt_cache_hit_tokens`; absent usage
stays absent rather than being reported as zero. API keys and session headers are
excluded. Logfire's standard sensitive-data scrubbing remains enabled.
Kestrel's subprocess requests and the remote inference server's GPU are outside
this instrumentation. System metrics describe the workflow container.

Operation spans cover ingestion (including each story), classification,
summarization, discussion analysis, and sentiment analysis through validation.
Failures emit error logs with exception tracebacks, operation/model/story context,
and error spans, including story failures caught so the batch can continue.
Application logging and retry warnings are forwarded into the current trace;
existing console logging remains intact. Exception details use Logfire's default
sensitive-data scrubbing. Thread-pool work retains parent trace context.

### Deployment verification and throughput

The `Ingestion` workflow remains reusable validation only. The separate
`Deploy ingestion` workflow automatically deploys `hn-ingestion` after relevant
merges to `main`: collector source, Modal entrypoint, dependencies, migrations,
Alembic configuration, or deployment workflow/helper changes. Documentation and
test-only pushes do not deploy. Pull requests run validation without production
secrets, migrations or deployment. A manual run on `main` uses the same gates;
manual runs on other branches only validate.

Deployment waits for ingestion tests and deployment-guard regressions, then calls
the existing `Supabase schema` workflow to apply pending migrations under its
shared `supabase-schema-production` lock. A failed gate blocks deployment. The
collector deploy job uses the existing `hacksnap-production` environment and its
`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` and `SUPABASE_PASSWORD` secrets, plus a
separate `hn-ingestion-modal-deploy` lock. It verifies the database schema and
checks that the tested commit is still current `main` immediately before deploying
from `data/`. Stale runs cannot roll back a newer collector deployment; rerun
`Deploy ingestion` on current `main` if a stale run was skipped. The schema gate
also rejects stale commits before migration.

After deployment, verify Modal history and the startup log's
`story_concurrency=4` value (run from `data/`):

```sh
uv run modal app history hn-ingestion --json
uv run modal app logs hn-ingestion --since 1d --search story_concurrency --timestamps
```

At the 29 September 2026 investigation, production was still v3, deployed on
27 September at commit `6b02d45`, before the parallel collector changes. This missing automatic deployment path
caused that drift; `Deploy ingestion` now updates the collector independently of
the image and summary app.

`ingestion_completed` reports run ID, success/failure, examined and matched
stories, persisted snapshots, elapsed seconds, concurrency and examined items
per minute. `classification_timing` separates shared-lock waiting from the
classification request/retry/cooldown sequence and includes failures. Four story
workers can overlap HN requests, but classification remains serialized for its
shared rate limit and comments within each story are fetched sequentially.
