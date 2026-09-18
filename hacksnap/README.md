# Hacksnap

An hourly article + HN discussion digest on top of the existing collector.
The worker never fetches Hacker News. Next.js renders structured summaries from
Supabase over a server-only PostgreSQL connection.

## Ranking

The `hacksnap_current_stories` database view is the shared ranking definition for
the worker and website:

1. Consider stories from successful AI-classified ingestion runs.
2. Prefer stories whose **first `date_added` is within the last 24 hours**.
3. Select the highest-point recent stories, filling remaining places from older
   eligible stories by points until there are ten.
4. Display the selected ten in **points descending** order. HN ID descending is
   the deterministic tie-breaker. An older fallback can therefore be ranked above
   a recent story with fewer points.

An empty or failed new ingestion run does not clear previous stories. If there
are fewer than ten eligible stories in the entire database, show all available
stories. Older fallback cards are labeled **Archive**. Scores are the latest
stored values, not live requests to HN.

The collector still runs as before. Its only change is setting
`hacker_news_threads.last_seen_run_id` in the existing upsert, including when a
snapshot is deduplicated. Migration 0004 backfills that pointer from the newest
successful stored snapshot. Exact historical membership cannot be recovered for
deduplicated observations; subsequent ingestion maintains it correctly.

## Files

```text
modal_app.py             hourly schedule + pinned Linux Kestrel image
pipeline/config.py      all runtime environment configuration
pipeline/supabase.py    existing PostgreSQL connection pattern + enrichment writes
pipeline/kestrel.py     bounded JSON CLI adapter
pipeline/preprocess.py  comment selection + deterministic fingerprint
pipeline/prompts.py     versioned editorial instructions
pipeline/summarise.py   schema-constrained Modal inference
pipeline/refresh.py     sequential, isolated per-story processing
web/                    Next.js homepage and /story/[id]
```

The existing `hn_thread_summaries` table is a snapshot-bound queue with a free-text
summary column. It remains untouched. `hacksnap_summaries` holds one validated,
structured enrichment per canonical story, without duplicating title, points,
comments or source timestamps.

## Set up

Requirements: Python 3.12+, uv, Node.js 22+, the existing Supabase database, and a
Modal account. Run commands from the repository root unless indicated otherwise.

**Apply the migration before running the updated collector or worker.** The
existing Supabase schema workflow is still responsible for production migrations.
For a manual deployment, load the existing credentials and use Alembic:

```sh
set -a
source .env
set +a
cd data
uv sync --locked
uv run alembic upgrade head
cd ..
```

For local runs, copy `hacksnap/.env.example` to `hacksnap/.env.local` and fill in the database
password and inference API key. The selected model is **moonshotai/Kimi-K3** at:

```text
https://rafaelpierre--ep-kimi-k3-server.us-west.modal.direct/v1
```

The endpoint was checked with a live synthetic structured-summary request.
Use `MODAL_LLM_REASONING_EFFORT=low`: the live Kimi K3 server rejects `none`, even
though the dashboard's default example includes it. The endpoint and model are
configuration, not dependencies of the pipeline.

The API key is a Modal proxy token ID and secret joined with a period, as described
in the [Modal endpoint docs](https://modal.com/docs/guide/endpoints). Keep it in a
GitHub environment secret for CI, or a local environment file for local runs. Do not commit it. An existing endpoint
alone does not provide a persistent credential for the scheduled worker.

For a local deployment, create the named Modal Secret from the filled environment
file (GitHub Actions syncs this secret automatically):

```sh
cd hacksnap
uv sync --locked
uv run modal secret create hacksnap --from-dotenv .env.local
uv run modal deploy modal_app.py
```

This deploys one function at `0 * * * *` UTC. It processes stories sequentially;
one container prevents overlapping refresh executions. The 40-minute timeout
bounds a run. Kestrel compilation happens while building the image, never per
scheduled invocation. It installs the exact published crates.io source release
with `cargo install kestrel-rs --version =10.1.0 --locked --bin kestrel`.
This builds a Linux binary using the release's Cargo lockfile and requires no
private-source upload or GitHub credentials. The public crate checksum and CLI
source were verified against the inspected local project. The Python image
dependencies use `uv.lock`.

To trigger a refresh manually:

```sh
uv run modal run modal_app.py::refresh_hacksnap
```

To run locally instead, install the same Kestrel release, set `KESTREL_BINARY`
to its executable, load `.env.local`, and run `uv run python -m pipeline.refresh`.

## Website

```sh
cd hacksnap/web
npm ci
# Copy .env.example to .env.local and fill HACKSNAP_WEB_DATABASE_URL,
# or use the existing SUPABASE_PASSWORD environment variable.
npm run dev
```

Open `http://localhost:3000`. Production runs with `npm run build` then `npm start`
on a normal Node.js/Next.js host. No frontend hosting provider is assumed.

Database access is server-only (`server-only` import, no public credentials), with
read-only transactions and an explicit public-data projection. New database
objects have RLS enabled or `security_invoker=true`, and no anonymous API access.
For a dedicated web database role, grant SELECT on `hacker_news_threads`,
`hn_ingestion_runs`, `hn_thread_snapshots`, `hacksnap_summaries`, and
`hacksnap_current_stories`, plus SELECT RLS policies for that role on the four
base tables. Do not grant writes
or give that role to browser clients. The existing pooler password remains a
supported PoC fallback, kept only on the server.

## Vercel frontend

Import the repository with root directory `hacksnap/web`, the Next.js preset,
and Node.js 22 or newer. Set the server-only `HACKSNAP_WEB_DATABASE_URL` variable
for the deployment environment. Copy the **Transaction pooler** URI from Supabase's
Connect dialog (port 6543) and URL-encode the database password. A dedicated
SELECT-only role with the grants and RLS policies described above is preferred.
The frontend does not need Modal credentials.

Supabase connections use `verify-full` TLS with the public CA in
`web/certs/supabase-ca.crt`, which Next.js includes in each server bundle.
The certificate was downloaded from
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`
and expires on 26 April 2031. Replace it if Supabase rotates its CA.
An explicit `sslrootcert` connection parameter overrides the bundled CA path.
Read-only mode and the statement timeout are applied within each transaction,
so they do not depend on persistent database sessions. Each instance keeps at
most one pooled connection and closes idle connections after five seconds.

Vercel's Git integration can deploy automatically, independently of the manual
GitHub Actions workflows. Configure its deployment policy to match your intended
release process. After changing environment variables, redeploy and check both
the homepage and a story detail page against real data.

## Cache and failures

The fingerprint includes the normalized extracted article, title, URL, HN post
text, the selected comments with IDs/parents/authors, model, and prompt version.
Points and comment-count changes alone do not trigger inference. The article is
fetched each refresh to detect content changes, but unchanged model inputs skip
inference. Bump `PROMPT_VERSION` when editing the prompt or preprocessing behavior.

Comment processing removes dead/deleted/empty entries, preserves ancestry, and
prefers active branches within a deterministic character budget. The input caps
are 24,000 article characters, 48,000 serialized comment characters and 8,000 HN
post characters, plus prompt/schema overhead; configure an endpoint with a
sufficient context window (128K or larger for typical text; reduce the budgets
for unusually token-dense input). This is not a tokenizer-specific exact token
count. The UI discloses stored-comment sampling
and further truncation; raw articles are not persisted.

Every output is validated against Pydantic and checked for invented comment IDs
and article claims without an article. HTML is never generated or injected into
the UI. Invalid or failed inference cannot overwrite a valid saved summary.
If fetching fails, an existing summary is retained; a new story can receive a
discussion-only summary. HN self-posts do not invoke Kestrel.

Failures log UTC time, story ID, URL without query/userinfo, stage, error type and
HTTP status or controlled fetch diagnostic. Arbitrary exception messages,
database connection strings, request headers and response bodies are not logged.

## Checks

From the repository root:

```sh
uv run --directory hacksnap pytest
uv run --directory hacksnap ruff check pipeline tests modal_app.py
uv run --directory data pytest
SUPABASE_PASSWORD=offline-test-only uv run --directory data alembic upgrade head --sql > /tmp/hacksnap-schema.sql
cd hacksnap/web
HACKSNAP_SCHEMA_SQL=/tmp/hacksnap-schema.sql npm run test:db
npm run build
```

Database tests execute the actual Alembic SQL in embedded PostgreSQL (PGlite),
covering recent preference, archive fallback, points ordering, empty runs,
deduplicated membership, and RLS. They never touch production.

Optional Linux image smoke test (uses Modal compute, no production data or schedule):

```sh
cd hacksnap
uv run modal run tests/modal_smoke.py
```

For an isolated UI preview, export the migration SQL as above, then start these
in separate terminals from `hacksnap/web`:

```sh
HACKSNAP_SCHEMA_SQL=/tmp/hacksnap-schema.sql node tests/preview-db.mjs
HACKSNAP_WEB_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run dev
```

All preview titles are labeled `[Demo]`. The database is ephemeral and contains
synthetic data only.

## GitHub Actions

`hacksnap.yml` tests the worker, ingestion regressions, actual migration SQL, and
production frontend build. Pull requests and pushes to `main` run validation only.
Production jobs in both `hacksnap.yml` and `supabase-schema.yml` run only through
GitHub Actions **Run workflow** (`workflow_dispatch`). Merging does not deploy the
Modal worker or apply database migrations.

For a production rollout, manually run **Supabase schema** against `main` first
and wait for it to succeed. Then manually run **Hacksnap** against `main`; after
tests pass, it verifies the schema version, syncs the worker secret, and deploys
the Modal function.

Configure these GitHub secrets in `hacksnap-production` (repository secrets are
also inherited unless overridden):

- `SUPABASE_PASSWORD`: database password.
- `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`: deployment API token pair.
- `MODAL_LLM_API_KEY`: inference proxy token ID and secret joined with a period.

Optional GitHub environment variables `MODAL_LLM_BASE_URL`, `MODAL_LLM_MODEL`, and
`MODAL_LLM_REASONING_EFFORT` override the endpoint, model, and `low` defaults shown
above. The manual deployment creates or replaces Modal's `hacksnap` Secret with
the database password, inference key, and model settings. GitHub is the source
of truth; changes made directly to that Modal Secret are overwritten on the next
deployment. Deployment API tokens are not copied into the worker secret.
A private temporary JSON file transfers the values and is removed afterward.

The `supabase-production` environment supplies the migration credentials.
No database writes are performed by the web build or deployment preflight.
Existing hourly Modal and HN ingestion schedules are unchanged by these manual
deployment gates. No frontend deployment is configured in these workflows.

No production schema migration, persistent proxy token creation, scheduled
deployment or public web deployment is performed by local tests.
