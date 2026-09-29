# Hacksnap

An article + HN discussion digest refreshed hourly during the day on top of the existing collector.
The Modal schedule runs on the hour from 09:00 through midnight, inclusive, in
`Europe/London` (16 runs per day). It follows GMT/BST automatically.
The worker never fetches Hacker News. Next.js renders structured summaries from
Supabase over a server-only PostgreSQL connection.

## Ranking

The `hacksnap_current_stories` database view is the shared ranking definition for
the worker and website:

1. Consider stories from successful AI-classified ingestion runs, excluding articles whose current URL previously failed to fetch.
2. Prefer stories whose **first `date_added` is within the last 24 hours**.
3. Select the highest-point recent stories, filling remaining places from older
   eligible stories by points until there are ten.
4. Display **recent stories first, then archive entries**, sorting each group by
   points descending. HN ID descending is the deterministic tie-breaker. An older
   fallback cannot rank above a recent story, even if it has more points.

Apply migration `0006_recent_first` to update the shared ranking for the worker
and website. Recency still uses the original collection time (`date_added`).

### Ranking history

Migration `0007_rank_history` adds `hacksnap_rank_history` with `hn_id`, `rank`,
and `observed_at` (timestamp with time zone). The `(hn_id, observed_at)` primary
key indexes each story's history. RLS and revoked client grants keep writes private.

`hacksnap_ranked_stories` ranks **all eligible stories** using the same recency,
points and ID ordering. `hacksnap_current_stories` supplies its first ten rows to the worker for enrichment.
The website selects the first ten stories from `hacksnap_ranked_stories` with a
nonblank `overall_takeaway` preview, filtering before the limit. Older eligible
stories fill any gaps using the same recent-first, points and ID ordering. This
selection is shared by homepage HTML, Markdown and the leaderboard API. Canonical
rank values are retained for consistency with recorded rank history, so displayed
ranks can have gaps. Fewer than ten cards appear only when fewer than ten eligible
stories have previews. Pending stories remain eligible for worker enrichment.
At the end of every worker refresh, after fetch failures are excluded, one atomic
insert records every eligible rank with a shared timestamp, including ranks below
10 and unchanged positions. This follows the worker's hourly daytime schedule;
manual refreshes also record observations. These are sampled positions, not every
intermediate change to the live view. Failed rank writes fail the refresh.

### Hotness sparklines

The feed keeps the **Hotness** label and plots observed **Hacksnap ranking positions**
over the past 24 hours. Climbing from #8 to #3 moves the line upward and shows
**+5** places; falling moves it downward; unchanged ranks stay flat. This follows
the site's recent-first, then points ranking, not Hacker News front-page rank.

History comes from `hacksnap_rank_history`, using its existing `(hn_id, observed_at)`
primary-key index, with at most 168 observations per story. No migration is needed.
The current queried rank is included at the shared read timestamp, so the chart's
endpoint matches the displayed position even between scheduled history captures.
The leaderboard cache key is bumped to discard the old point-velocity payloads.

The card's places-change badge compares the displayed rank with the latest saved
rank when they differ. Once the worker records that position, it compares the two
latest captures, preserving the newly recorded move. A subsequent unchanged
capture reports zero; missing comparison history displays a dash.

The horizontal axis fills the chart with available history from the past 24 hours,
with elapsed-time spacing and a label showing the actual span (for example, 6h).
Earlier history is not filled in. Rank #1 is at the top and #10 at the bottom,
with the scale expanding for stories previously ranked below ten. Gentle curves pass through observations without overshooting; intermediate positions
are unknown. Teal indicates a net climb, coral a fall, and gray no net change. Hover, focus, touch and arrow keys
expose the observed rank, timestamp, and scale. A single observation shows a dot
and “—” for change; no observations shows “Collecting history”. The headline is
first observed rank minus latest observed rank within the window, not necessarily
a full 24-hour change when history is sparse. Markdown and RSS use the same ranks
and change calculation.

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
modal_app.py             hourly London daytime schedule + pinned Linux Kestrel image
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
password and inference API key. The selected model is **deepseek-ai/DeepSeek-V4.1-Flash** at:

```text
https://rafaelpierre--ep-deepseek-v4-1-flash-server.us-west.modal.direct/v1
```

To use GLM 5.3 Flash instead, replace both settings in your local environment or
set these values in Modal's `hacksnap` Secret for the scheduled worker:

```dotenv
MODAL_LLM_BASE_URL=https://rafaelpierre--ep-glm-5-3-flash-server.us-west.modal.direct/v1
MODAL_LLM_MODEL=zai-org/GLM-5.3-Flash
```

Manage the scheduled worker's endpoint, model, and inference credentials in Modal's
`hacksnap` Secret. GitHub Actions deploys the code without modifying that secret.

Both replacement endpoints passed a live synthetic structured-summary smoke test
on 2026-09-18 using the pipeline's exact request format: strict JSON-schema output,
`MODAL_LLM_REASONING_EFFORT=low`, temperature 0.2, and an 8,000-token output limit.
Both completed normally and passed schema and source-ID validation. This was one
small request per model, not a quality or latency benchmark on production stories.
The endpoint and model are configuration, not dependencies of the pipeline.

Initial summaries use prompt `v7-editorial-summaries`, retaining cited discussion
analysis. The smoke test above predates this prompt. See
[initial analysis validation and measurement status](../docs/evaluations/issue-36-initial-analysis.md)
for the response budget, local checks, and metrics to collect during normal processing.

### Summary writing style

`pipeline/prompts.py` defines Hacksnap's editorial voice: Bloomberg-style specificity
and information density, with Financial Times-style clarity, restraint and skepticism.
The source and underlying technical questions lead the coverage.

- **TLDR:** `article_summary` opens with the source's central contribution in 2–4
  sentences, followed by factual, non-repeating `article_key_points`. Prefer 4–6
  bullets (within the existing six-item schema), fewer when evidence is sparse.
- **Discussion:** `discussion_summary` opens with the central tension and develops
  competing interpretations in roughly 2–5 compact paragraphs. Blank lines separate
  paragraphs; HTML and Markdown preserve those breaks. Sparse discussions need less.
- Distinguish proposals, reported results, verified findings and interpretations.
  Attribute experience or original evidence where provenance matters, retain material
  uncertainty, and avoid hype, generic openings and claims of community consensus.
- The model performs a final editorial pass on those three fields. Detailed discussion
  points, claims, supportive/critical highlights, topics, sentiment and the takeaway
  keep their existing instructions. The response remains schema-constrained JSON,
  with the existing 32,000-token response limit and concise output targets (up to
  220 words for the Discussion introduction).

This version applies to newly generated summaries after worker deployment. Existing
summaries and Discussion introductions are retained; the normal evidence refresh
updates only discussion analysis. This change does not backfill or regenerate prose.
Automated checks verify prompt wiring, persistence and rendering; they do not establish
live model writing quality. Review generated prose during the normal rollout.

The API key is a Modal proxy token ID and secret joined with a period, as described
in the [Modal endpoint docs](https://modal.com/docs/guide/endpoints). Keep it in
Modal's `hacksnap` Secret for the scheduled worker, or a local environment file for local runs. Do not commit it. An existing endpoint
alone does not provide a persistent credential for the scheduled worker.

For manual endpoint tests, `uv run modal curl` can authenticate using the existing
CLI credentials in `~/.modal.toml`; a local inference key is not required. Those
CLI credentials are distinct from proxy tokens. The scheduled worker still uses
`MODAL_LLM_API_KEY` for its bearer-token authentication.

For a local deployment, create the named Modal Secret from the filled environment
file if the secret does not already exist:

```sh
cd hacksnap
uv sync --locked
uv run modal secret create hacksnap --from-dotenv .env.local
uv run modal deploy modal_app.py
```

This deploys one function at `0 0,9-23 * * *` in `Europe/London`.
It processes stories sequentially;
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
# using the dedicated hacksnap_reader login.
npm run dev
```

Open `http://localhost:3000`. Production runs with `npm run build` then `npm start`
on a normal Node.js/Next.js host. No frontend hosting provider is assumed.

Database access is server-only (`server-only` import, no public credentials), with
read-only transactions and an explicit public-data projection. New database
objects have RLS enabled or `security_invoker=true`, and no anonymous API access.
Migration `0010_web_reader` creates `hacksnap_reader` with SELECT-only column grants
and role-specific SELECT policies on the six required base tables. It cannot
read raw content, snapshot payloads, or ingestion diagnostics, and cannot write.
Provision its password separately, then set `HACKSNAP_WEB_DATABASE_URL` using
`hacksnap_reader.PROJECT_REF` as the pooler username. Supabase web connections
reject other roles; there is no administrator-password fallback.

The website, collector, enrichment worker, and MCP use direct Postgres. Keep the
Supabase Data API disabled under Integrations → Data API → Overview. This
setting is managed in Supabase, separately from Alembic migrations.

## Vercel frontend

Import the repository with root directory `hacksnap/web`, the Next.js preset,
and Node.js 22 or newer. Set the server-only `HACKSNAP_WEB_DATABASE_URL` variable
for the deployment environment. Copy the **Transaction pooler** URI from Supabase's
Connect dialog (port 6543) and URL-encode the database password. A dedicated
SELECT-only `hacksnap_reader` role is required.
The frontend does not need Modal credentials.

Supabase connections use `verify-full` TLS with the public CA in
`web/certs/supabase-ca.crt`, which Next.js includes in each server bundle.
The certificate was downloaded from
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`
and expires on 26 April 2031. Replace it if Supabase rotates its CA.
An explicit `sslrootcert` connection parameter overrides the bundled CA path.
Read-only mode and the statement timeout are applied within each transaction,
so they do not depend on persistent database sessions. Each instance keeps at
most one pooled connection and closes idle connections after 90 seconds.
The homepage shares a persistent Next.js data cache with a 30-minute revalidation
interval. The first request fills the cache; after it expires, a request serves
the saved data while refreshing it in the background. Failed refreshes retain
the last successful result. The homepage and story HTML use ISR with a 30-minute
revalidation interval and are generated on their first visit. Builds do not connect
to the database. The delayed-update notice is evaluated when the homepage
regenerates. See `web/README.md` for Cloudflare cache configuration.
On a cache miss, the stories and ingestion timestamp use one SQL query; including
the read-only transaction setup and commit, this takes three database round trips.
For Vercel, configure the function region close to the Supabase database
(the current database is in Ireland) to reduce the remaining network latency.

Vercel's Git integration can deploy automatically, independently of the manual
GitHub Actions workflows. Configure its deployment policy to match your intended
release process. After changing environment variables, redeploy and check both
the homepage and a story detail page against real data.

### Sitemap

`/sitemap.xml` serves a Next.js XML sitemap with canonical `https://hacksnap.live`
URLs for the homepage, archive pages, and `/story/[id]` pages with summaries,
including archived stories. Pending stories are excluded and serve `noindex, follow`
until their summary is available and the page revalidates (a 30-minute cache interval).
The sitemap reads story IDs in a server-only, read-only transaction on every request,
so additions and deletions appear without a rebuild or cache purge. Builds do not
require database access. `/robots.txt` advertises
`Sitemap: https://hacksnap.live/sitemap.xml`.

After deploying, POST `{"url":"https://hacksnap.live"}` as JSON to
`https://isitagentready.com/api/scan` and check that
`checks.discoverability.sitemap.status` is `"pass"`.

### Public Stories API and catalog

`GET /.well-known/api-catalog` returns an RFC 9727 Linkset with HTTP 200 and
`application/linkset+json`, linking the Stories API to `/openapi.json` and
`/docs/api`. HEAD returns the same content type and an `api-catalog` Link header.
All web responses also advertise the catalog in a Link header. These discovery
resources do not need database access.

`GET /api/stories` returns the current ranked stories and ingestion timestamp,
using the homepage's shared 30-minute data cache. `GET /api/stories/{id}` returns
one story, including archived stories, using a minimal primary-key query with a
five-minute bounded per-instance cache (one minute for missing stories). Successful
responses also permit five minutes of shared HTTP caching; safe 404s permit one
minute. See `web/README.md` for freshness bounds and per-instance admission limits.
Both are public and read-only, exposing
an explicit set of story fields and summary text. Invalid IDs return 400,
unknown stories return 404, and data failures return a sanitized 503 with
`Retry-After: 60`. See `/docs/api` for the response contract and polling guidance.

Run `npm run test:api`, `npm run typecheck`, and `npm run build` from `web/`.
After deploying the frontend, validate the public catalog with:

```sh
curl -sS https://isitagentready.com/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://hacksnap.live"}'
```

Check that `checks.discovery.apiCatalog.status` is `"pass"`.

## Cache and failures

Existing summaries are retained without fetching the article or regenerating the
summary. For current top-10 stories, sentiment is estimated separately when a
score is missing or the prepared comment sample has changed. Sentiment uses a
stable pseudorandom sample of at most 10 usable comments from the prepared
discussion; fewer comments use all available ones. The sample is selected by a
stable hash of comment IDs, so unchanged input never resamples randomly. Summary
generation still uses the full prepared discussion, but its sentiment field is
restricted to the separately supplied ten-comment sample. A fingerprint of
only the selected, normalized comments is stored in
`source_coverage.sentiment.comments_fingerprint`; unchanged scored comments skip
inference, including a Neutral score of 0. A processed empty sample stores null
and its fingerprint, so it also skips repeated inference. Missing retained source
content is reported as unavailable and leaves saved data untouched.

Legacy scored rows without a comment fingerprint reuse their score if the saved
summary content hash matches the retained content; otherwise the first refresh
establishes a separate comment fingerprint. New stories still receive a full,
validated summary and sentiment together. Sentiment-only updates preserve summary
text, generation time, source fingerprint, and summarized content hash, and keep
sentiment sampling metadata separate from the original summary's coverage.

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
Inference has a 32,000-token response budget, including model reasoning. The previous
8,000-token cap truncated initial summaries and discussion refreshes in production.
Incomplete responses are rejected; a later scheduled run retries eligible stories.
If fetching fails, the worker records the story ID and failed URL permanently.
The shared leaderboard excludes that story while its URL matches the failure record,
and the worker processes the next eligible story in the same refresh. Existing
summaries remain stored; no discussion-only fallback is generated for failed articles.
Refreshes attempt at most 50 distinct stories to bound work if many articles fail.
A corrected story URL becomes eligible automatically; to deliberately retry an
unchanged URL, delete its row from `hacksnap_fetch_failures`. A missing Kestrel
executable is a worker configuration error and does not exclude articles.
Article fetch failures are logged as warnings and counted as `fetch_skipped`; they
do not fail the scheduled run. Per-story inference, storage, and worker configuration
errors are counted as
`failed` in the result and `refresh_completed` log, while other stories continue.
The Modal invocation can still succeed with a nonzero failure count. Errors outside
per-story processing, including ranking-history writes and cleanup, fail the invocation.
HN self-posts still receive discussion summaries without fetching an article.

Apply migration `0005_fetch_failures` before deploying the updated worker. It also
excludes legacy summaries marked with `article_status=unavailable`; failures only
present in old logs are recorded when next encountered. Dedicated read-only web
roles need SELECT and a SELECT RLS policy on `hacksnap_fetch_failures` as well.

Failures log UTC time, story ID, URL without query/userinfo, stage, error type and
HTTP status or controlled fetch diagnostic. Arbitrary exception messages,
database connection strings, request headers and response bodies are not logged.

### Discussion analysis refresh

Existing new-format stories refresh stance highlights and topics from retained
comments and their saved reference claims. Claims are reused verbatim; the worker
never re-fetches the article or regenerates its brief. Legacy stories continue
through sentiment-only refresh and receive no analysis backfill.

The discussion cache includes the full prepared sample, available parent context,
coverage, reference claims, source version, model, schema and refresh-prompt version.
Initial generation primes that cache. The metadata still records the prompt that
actually generated the analysis. Existing analyses from the earlier worker may
refresh once to adopt this fingerprint format. Unchanged inputs skip inference;
missing retained source and failed inference preserve the last valid analysis.
`discussion_analyzed_at` advances only on successful analysis generation, separately
from article `generated_at`. Refreshes count as `analysis_updated` in job results.

Migration `0013_discussion_retention` makes early content and snapshot cleanup wait
for the private `discussion_content_hash` column to match the raw source version.
Analysis writes commit this acknowledgement atomically; normalized cache hits can
acknowledge a raw version without changing analysis time. Concurrent analysis writes
are checked against the previously read fingerprint. Legacy cleanup and seven-day
expiry are unchanged. Collector ingestion uses the same acknowledgement to avoid
discarding inputs before refresh.

Apply the migration before deploying the collector and enrichment worker. The
collector uses its manual workflow; the enrichment worker deploys on relevant main
pushes or through a manual Hacksnap run. The migration performs no cleanup or
backfill. An older initial-generation worker remains usable after the migration; its new-format rows
without acknowledgements retain source until refreshed or expired. Roll back both
collector and refresh worker before downgrading the cleanup function.

## Checks

From the repository root:

```sh
uv run --directory hacksnap pytest
uv run --directory hacksnap ruff check pipeline tests modal_app.py
uv run --directory data pytest
cd hacksnap/web
npm ci
npm run lint
npm run format:check
npm run test:ci
npm run typecheck
npm run build
```

Frontend tests use Jest for unit and component tests. Database and live HTTP
integration tests and their synthetic database fixture have been removed.

Optional Linux image smoke test (uses Modal compute, no production data or schedule):

```sh
cd hacksnap
uv run modal run tests/modal_smoke.py
```

## GitHub Actions

`hacksnap.yml` runs worker lint and tests for pull requests and pushes to `main`
that change `hacksnap/**` outside `hacksnap/web/**`, or the worker workflow and its
deployment helpers/tests. This includes direct test-only pushes to `main`.

A separate job checks the full before/after commit range of a main push. Only changes
to these production paths enable deployment and its ingestion/frontend prerequisites:

- `hacksnap/pipeline/**`
- `hacksnap/modal_app.py`
- `hacksnap/pyproject.toml`
- `hacksnap/uv.lock`
- `.github/workflows/hacksnap.yml`
- `.github/scripts/deploy-modal.sh`
- `.github/scripts/modal-deploy-changes.py`

Frontend-only, documentation-only, fixture-only and test-only changes do not trigger
an automatic worker deployment; matching worker paths still run worker validation.
Failed change detection blocks deployment without suppressing the independent worker
checks. **Run workflow** (`workflow_dispatch`) remains
available for manual deployment.

Automatic and manual deployments both require worker and ingestion tests, frontend
Jest tests, Oxlint, Oxfmt, TypeScript checks and the production frontend build. After
those pass, deployment verifies the database schema version and runs `modal deploy`
using the existing `hacksnap` Secret in Modal. The `hacksnap-production` environment
and deployment concurrency controls apply to both paths, including any configured
environment approval rules. Pull requests do not deploy.

While holding the deployment concurrency slot, the worker queries GitHub for the
current `main` SHA immediately before calling Modal. It deploys only if that SHA
matches the revision validated by this run. Older runs skip deployment with a notice
and job summary; failed or invalid revision lookups fail the job without deploying.
This applies to automatic and manual runs, preventing an older validation run from
rolling back a newer deployment. The job never switches to untested code.

If `main` advances with a change outside the deployment paths while validation is
running, the earlier run will also skip. Start a new **Hacksnap** manual run on current
`main` when needed; rerunning the old run retains its old SHA and will skip again.

Database migrations remain manual. For changes that need a migration, run
**Supabase schema** against `main` before the worker deployment reaches its schema
check. If automatic deployment stops because the schema is behind, apply the
migration and rerun **Hacksnap** against `main`. This workflow never applies migrations.

Configure these GitHub secrets in `hacksnap-production` (repository secrets are
also inherited unless overridden):

- `SUPABASE_PASSWORD`: database password.
- `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`: deployment API token pair.

Worker configuration lives in Modal's `hacksnap` Secret: the database password,
`MODAL_LLM_API_KEY`, `MODAL_LLM_BASE_URL`, `MODAL_LLM_MODEL`, and any
`MODAL_LLM_REASONING_EFFORT` override. GitHub Actions does not require inference
variables or credentials and does not create or overwrite this secret.

The `supabase-production` environment supplies the migration credentials.
No database writes are performed by the web build or deployment preflight.
The hourly daytime Modal enrichment and hourly HN ingestion schedules are unchanged
by these deployment triggers. No frontend deployment is configured in these workflows.

No production schema migration, persistent proxy token creation, scheduled
deployment or public web deployment is performed by local tests.

### Disposable source content

After migration 0008, the worker reads raw inputs from `hn_thread_contents`.
Saved summaries retain `summarized_content_hash` for the content actually used
to generate them. Sentiment-only refreshes do not advance that hash. Absent
content is counted as unavailable, rather than fabricated as an empty discussion.
Each scheduled refresh runs one bounded retention batch, including snapshot payloads.
See [retention and deployment](../data/README.md#source-content-retention-migration-0008)
for the seven-day cutoff, grants and coordinated deployment steps.

### Comment sentiment

The front page displays sentiment to the left of hotness: **−1 Skeptical**,
**0 Neutral**, or **+1 Excited**, with a three-position scale. The summary model
estimates the reaction to the story from sampled comments only. Mixed, factual
or inconclusive reactions are Neutral; no usable comments produce `null` and
“No comments,” rather than a fabricated neutral score. This is a qualitative
sample estimate, not a community vote.

Apply Alembic migration `0009_sentiment` before deploying the web app and summary
worker. It adds a nullable, constrained small integer to `hacksnap_summaries`;
existing summaries remain unscored and display “Pending.” Existing summaries with
retained comments receive missing sentiment through a separate inference request
on their next successful top-10 refresh.
Older stories without retained comments remain unscored until ingested again.

## Comment-analysis rollout and fallback

See [issue #42 release verification](../docs/evaluations/issue-42/README.md) for
the semantic evaluation command, deployment evidence, pending production checks,
and steps to pause generation or hide analysis while preserving stored data.
