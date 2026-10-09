# Hacksnap

An article + HN discussion digest refreshed hourly during the day on top of the existing collector.
The Modal schedule runs on the hour from 09:00 through midnight, inclusive, in
`Europe/London` (16 runs per day). It follows GMT/BST automatically.
The worker never fetches Hacker News. Next.js renders structured summaries from
Supabase over a server-only PostgreSQL connection.

## Ranking

The `hacksnap_ranked_stories` database view defines the shared ranking for
the worker and website:

1. Consider stories from successful AI-classified ingestion runs, excluding articles whose current URL previously failed to fetch.
2. Prefer stories whose **first `date_added` is within the last 24 hours**.
3. Sort **recent stories first, then archive entries**, ordering each group by
   points descending. HN ID descending is the deterministic tie-breaker. An older
   fallback cannot rank above a recent story, even if it has more points.
4. Enrich up to 50 ranked stories per worker run. The website displays the first
   ten eligible stories with a published summary preview.

Apply migration `0006_recent_first` to update the shared ranking for the worker
and website. Recency still uses the original collection time (`date_added`).

### Ranking history

Migration `0007_rank_history` adds `hacksnap_rank_history` with `hn_id`, `rank`,
and `observed_at` (timestamp with time zone). The `(hn_id, observed_at)` primary
key indexes each story's history. RLS and revoked client grants keep writes private.

`hacksnap_ranked_stories` ranks **all eligible stories** using the same recency,
points and ID ordering. The worker selects up to its first 50 rows for enrichment;
`hacksnap_current_stories` remains the top-ten view.
The legacy ranked APIs select the first ten stories from `hacksnap_ranked_stories` with a
nonblank `overall_takeaway` preview, filtering before the limit. Older eligible
stories fill any gaps using the same recent-first, points and ID ordering. This
selection is shared by the ranked APIs. The homepage at `/` and its Markdown
representation instead list published stories newest first in batches of 15; dated
feeds at `/YYYY/MM` and topics use the same publication rule and batch size. Canonical
rank values are retained for consistency with recorded rank history, so displayed
ranks can have gaps. Ranked APIs return fewer than ten cards only when fewer than ten eligible
stories have previews. Pending stories remain eligible for worker enrichment.
At the end of every worker refresh, after fetch failures are excluded, one atomic
insert records every eligible rank with a shared timestamp, including ranks below
10 and unchanged positions. This follows the worker's hourly daytime schedule;
manual refreshes also record observations. These are sampled positions, not every
intermediate change to the live view. Failed rank writes fail the refresh.

### Ranking history

Ranking history records observed **Hacksnap ranking positions**, distinct from
Hacker News front-page rank. Feed cards no longer render a Hotness sparkline;
ranking metrics remain available in Markdown exports.

History comes from `hacksnap_rank_history`, using its existing `(hn_id, observed_at)`
primary-key index, with at most 168 observations per story. No migration is needed.
The current queried rank is available to ranking calculations between scheduled
history captures.

The historical places-change calculation compares saved observations; intermediate
positions are unknown. Markdown and RSS retain textual ranking metrics.

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
pipeline/refresh.py     bounded parallel, isolated per-story processing
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

Keep `MODAL_LLM_BASE_URL` and `MODAL_LLM_MODEL` on DeepSeek for initial summaries
and discussion-analysis refreshes. Sentiment uses **nvidia/GLM-5.3-Flash-NVFP4**
independently, with these defaults:

```dotenv
MODAL_SENTIMENT_BASE_URL=https://rafaelpierre--ep-glm-5-3-flash-nvfp4-server.us-west.modal.direct/v1
MODAL_SENTIMENT_MODEL=nvidia/GLM-5.3-Flash-NVFP4
MODAL_SENTIMENT_REASONING_EFFORT=low
```

Manage the scheduled worker's endpoint, model, and inference credentials in Modal's
`hacksnap` Secret. GitHub Actions deploys the code without modifying that secret.
`MODAL_SENTIMENT_API_KEY` is optional and falls back to `MODAL_LLM_API_KEY`.
The collector separately selects the GLM endpoint in `data/modal_app.py`, so its
model does not inherit the worker's DeepSeek setting from the shared secret.
Deploy the collector from `data/` with `uv run modal deploy modal_app.py` when its
classification configuration changes; the worker deployment workflow deploys only
the enrichment app. No historical category backfill is required for this switch.

New summaries keep the established DeepSeek request schema, then replace its
sentiment score with a separate GLM request over the same ten-comment sample.
GLM receives only comments, never the article or initial-summary schema. A failed
sentiment request prevents publishing a new summary with a misattributed score;
existing summaries/scores are retained on sentiment failure. Empty samples need
no GLM request. Both models keep independent prompt warm-ups and session affinity.

The split passed a synthetic smoke check on 2026-09-29 using the scheduled jobs'
credentials: GLM classification and new/refreshed sentiment, plus DeepSeek initial
summary and discussion refresh. To repeat without database access or content writes,
run `uv run modal run tests/modal_model_routing_smoke.py` from `hacksnap/`.

Both replacement endpoints passed a live synthetic structured-summary smoke test
on 2026-09-18 using the pipeline's exact request format: strict JSON-schema output,
`MODAL_LLM_REASONING_EFFORT=low`, temperature 0.2, and an 8,000-token output limit.
Both completed normally and passed schema and source-ID validation. This was one
small request per model, not a quality or latency benchmark on production stories.
The endpoint and model are configuration, not dependencies of the pipeline.

Initial summaries use prompt `v8-discussion-bullets`, retaining cited discussion
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
- **Discussion:** the model returns `discussion_summary` as an object with a short
  `opening` sentence and 2–4 `bullets`, each covering one main argument or caveat in
  1–2 short sentences. Aim for 100–180 words total; leave secondary tangents to the
  detailed analysis. Sparse discussions need fewer bullets; no comments means none.
  The inference schema caps the opening at 300 characters and each bullet at 450.
  Source validation requires at least one bullet when comments are supplied and
  rejects bullets when no comments are supplied, before any summary is saved.
  The worker inserts blank lines and bullet markers into the stored summary string.
  RSS retains the same plain-text content. Story HTML and Markdown now show
  discussion themes instead of this introduction.
  Storage is unchanged; no migration is needed.
- Distinguish proposals, reported results, verified findings and interpretations.
  Attribute experience or original evidence where provenance matters, retain material
  uncertainty, and avoid hype, generic openings and claims of community consensus.
- The model performs a final editorial pass on those three fields. Detailed discussion
  points, topics, sentiment and the takeaway keep their existing instructions.
  The response remains schema-constrained JSON,
  with the existing 32,000-token response limit and concise output targets (up to
  180 words for the Discussion introduction).

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
It processes stories concurrently with a hard limit of **15 active story jobs**.
Each run selects up to **50 stories** from the full ranking, including stories
below the website’s top-ten display. This is a cap on all attempted stories,
including cache hits, missing content and failures, rather than 50 guaranteed new
summaries. Fetching and preprocessing can overlap immediately. The first
actual model request for each prompt/schema combination completes before other
requests using that combination begin. Summary, discussion-refresh and sentiment
prompts have separate warm-ups: completing a discussion refresh does not warm the
summary prefix. Cold warm-ups run one at a time. Same-prompt waiters are released
by their own completion event, so they can run concurrently even while another
prompt is warming. Each warm-up result is used normally, with no extra inference
request. Cached stories and failed fetches do not consume a warm-up, and a failed
warm-up releases the remaining requests for its prompt.
Each model retains its own run-scoped `Modal-Session-Id`; cache reuse is best
effort and depends on the endpoint's routing and prefix-cache configuration.
After each batch finishes, the worker re-reads the ranking for replacements,
attempts each story at most once, and keeps the 50-story limit. Rank history and
retention cleanup run after all story jobs finish. Database operations use separate
connections and model requests share the HTTP client's connection pool.
One container prevents overlapping refresh executions. The 40-minute timeout
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
most one primary reader connection plus one lazily created Trending connection;
idle connections close after 90 seconds. The weekly aggregate uses the separate
pool so it cannot block required page reads from concurrent requests. Both pools
retain the same reader credentials, TLS verification and transaction safeguards.
The leaderboard APIs use a bounded 60-second per-instance data cache shared
within each instance. Latest uses the bounded browse-page cache. Expired reads wait for fresh
data; failed reads show the existing unavailable state instead of retaining stale
rankings. Concurrent callers share one load. Separate instances may differ within
that one-minute window. Homepage and story HTML render per request; story data keeps
its existing 30-minute cache. Builds do not connect to the database.
See `web/README.md` for Cloudflare caching.
On a cache miss, the stories and ingestion timestamp use one SQL query; including
the read-only transaction setup and commit, this takes three database round trips.
For Vercel, configure the function region close to the Supabase database
(the current database is in Ireland) to reduce the remaining network latency.

Vercel's Git integration deploys `main` automatically, independently of the manual
GitHub Actions workflows. `web/vercel.json` disables automatic deployments for all
other branches, including pull-request previews, using `git.deploymentEnabled`.
Keep `main` configured as the Vercel project's Production Branch. This Git policy
does not block explicit CLI/API deployments. After changing environment variables,
redeploy and check both the homepage and a story detail page against real data.

### Sitemap

`/sitemap.xml` serves a Next.js XML sitemap with canonical `https://hacksnap.live`
URLs for Latest at `/`, dated feeds at `/YYYY/MM`, topics, and `/story/[id]` pages
with published takeaways, including older stories. Retired archive paths are not
advertised. Missing, NULL, empty or whitespace-only takeaways are excluded and
serve `noindex, follow` until their takeaway is published and the page revalidates (a 30-minute cache interval).
The sitemap reads story IDs in a server-only, read-only transaction on every request,
so additions and deletions appear without a rebuild or cache purge. Builds do not
require database access. `/robots.txt` advertises
`Sitemap: https://hacksnap.live/sitemap.xml`.

After deploying, POST `{"url":"https://hacksnap.live"}` as JSON to
`https://isitagentready.com/api/scan` and check that
`checks.discoverability.sitemap.status` is `"pass"`.

### Internal feed endpoints

`GET /api/ready-stories` is a pagination endpoint for the existing
summary-ready ranked pool. Its `pagination.cursor` is a portable, unsigned public
selection of ordered IDs, ranks and recency flags; it is not a credential. Send it
back as `cursor` to receive the next batch. The cursor freezes membership and rank
order for eight hours, while card details can refresh. Invalid cursors return 400;
expired or no-longer-ready selected rows return 410, so callers restart from the
first batch. The response exposes `selectionLimited` when its bounded 400-story
selection ends before the full pool; this is distinct from `hasMore: false` for an
exhausted selection. Markdown and RSS are also available.
The web app compares this bounded selection's IDs during an active Top-feed visit;
a new member offers an explicit fresh selection without reordering the open feed.
This is in-session selection freshness, with no previous-visit history or exact count.

Run `npm run test:api`, `npm run typecheck`, and `npm run build` from `web/`.

## Cache and failures

Existing summaries are retained without fetching the article or regenerating the
summary. For the worker’s top-50 stories, sentiment is estimated separately when a
score is missing or the prepared comment sample, sentiment model or prompt version
has changed. Sentiment uses a
stable pseudorandom sample of at most 10 usable comments from the prepared
discussion; fewer comments use all available ones. The sample is selected by a
stable hash of comment IDs, so unchanged input never resamples randomly. Summary
generation still uses the full prepared discussion; a separate GLM request supplies
the persisted sentiment from the ten-comment sample. A fingerprint of
the selected, normalized comments, sentiment model and sentiment prompt version is stored in
`source_coverage.sentiment.comments_fingerprint`; unchanged scored comments skip
inference, including a Neutral score of 0. A processed empty sample stores null
and its fingerprint, so it also skips repeated inference. Missing retained source
content is reported as unavailable and leaves saved data untouched.

Legacy scored rows without model-aware fingerprints are rescored once during
normal processing of retained content. The sentiment model and prompt version are
also recorded in `source_coverage.sentiment`. New stories still receive a full,
validated summary and sentiment together. Sentiment-only updates preserve summary
text, generation time, source fingerprint, and summarized content hash, and keep
sentiment sampling metadata separate from the original summary's coverage.

Initial summaries and discussion refreshes use the same deterministic sample of at
most four top-level threads. Roots rank by descendant count in the retained tree,
then comment ID ascending. Removed nodes count as retained activity and connect
ancestry, but dead/deleted/empty text is never supplied. Replies with missing root
ancestry or cycles are omitted. Root context is selected first, then active reply
branches, keeping all usable ancestors before a reply. Selected threads serialize
in root rank order, with parents before children. Oversized comments and replies
whose usable ancestors cannot fit are omitted whole; the selector never cuts prose.

The combined comment list defaults to 12,000 characters, including comment metadata,
JSON escaping, separators and brackets, using the inference serializer's
`ensure_ascii=False` format. Configure `Settings.comment_chars` or the explicit
`comment_budget` argument on `process_story`/`refresh`; budgets below two characters
are rejected because even `[]` needs two. Coverage counts usable stored comments,
actually included comments, and omissions. The existing selection-method schema
is preserved; new prompt versions invalidate cached analysis under this policy.
The prompts synthesize only the selected sample and never require opposing views
or imply consensus. Sentiment still samples at most ten of the prepared comments.

The input caps are 24,000 article characters, 12,000 serialized comment characters
and 8,000 HN post characters, plus prompt/schema overhead; configure an endpoint with a
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

Existing new-format stories refresh themes from retained comments. The worker
does not re-fetch the article or regenerate its brief. New analysis no longer asks
the model for reference claims or critical/supportive comments. Legacy stories continue
through sentiment-only refresh and receive no analysis backfill.

Apply Alembic migration `0018_discussion_themes_schema` before deploying this worker.
It keeps historical v1 analyses valid and lets v2 theme-only analyses persist with
empty claim and stance arrays. It changes two check constraints without rewriting
or backfilling rows. Downgrading requires removing v2 analysis rows first.

The discussion cache includes the full prepared sample, available parent context,
coverage, source version, model, schema and refresh-prompt version.
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
- `.github/scripts/migrate-schema.sh`
- `.github/workflows/supabase-schema.yml`

Frontend-only, documentation-only, fixture-only and test-only changes do not trigger
an automatic worker deployment; matching worker paths still run worker validation.
Failed change detection blocks deployment without suppressing the independent worker
checks. **Run workflow** (`workflow_dispatch`) remains
available for manual deployment.

Automatic and manual deployments both require worker and ingestion tests, frontend
Jest tests, Oxlint, Oxfmt, TypeScript checks and the production frontend build. After
those pass, the reusable **Supabase schema** workflow validates the migration graph
and applies pending Alembic upgrades. Deployment then verifies the database schema
version and runs `modal deploy` using the existing `hacksnap` Secret in Modal.
The `hacksnap-production` environment and deployment concurrency controls apply to
both paths, including any configured
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

Every eligible automatic or manual worker deployment calls **Supabase schema** at
the same commit after validation. `alembic upgrade head` applies only pending
migrations and makes no schema changes when already current. Migration failure
blocks Modal deployment. The migration job retains the `supabase-production`
environment and shared `supabase-schema-production` concurrency group, including
any configured approval rules. It checks the current `main` SHA before database
access; a stale run fails and requires a new run on current `main`.

Standalone schema pushes and pull requests validate only. **Supabase schema** can
still be run manually against `main` for a separate schema rollout. Test-only worker
pushes skip both schema migration and Modal deployment. If a previous worker run
failed at the old schema preflight, start a new **Hacksnap** run on current `main`
after this workflow change is merged.

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
on their next successful top-50 worker refresh.
Older stories without retained comments remain unscored until ingested again.

## Comment-analysis rollout and fallback

See [issue #42 release verification](../docs/evaluations/issue-42/README.md) for
the semantic evaluation command, deployment evidence, pending production checks,
and steps to pause generation or hide analysis while preserving stored data.

## Article images

Publisher image ingestion runs independently of summaries and remains disabled until
`HACKSNAP_IMAGES_ENABLED=true` is configured with a server-only Blob token. The
image worker tries Open Graph, Twitter and JSON-LD metadata, then generates a
branded fallback. New canonical assets are stored as 1200 × 630 WebP images in a
public Vercel Blob store. Existing ready images retain their URLs and dimensions.
The website receives only canonical image metadata; publisher source
URLs and retry diagnostics remain private.

After each completed Modal summarization run, `refresh_hacksnap` asynchronously
triggers `refresh_article_images` when images are enabled. Images require published
summaries, so the handoff follows summarization rather than raw HN collection.
The image worker has no separate schedule: automatic runs follow the hourly
09:00-through-midnight `Europe/London` summary starts, including completion of the
midnight run. Quiet summary runs also trigger a bounded sweep to recover pending
jobs, expired leases and eligible retries. A dispatch failure is logged without
failing publication; recovery waits for the next completed summary run. Manual
image-worker and backfill invocations remain available.

Apply migrations through `0016_image_queue` before deploying the updated worker.
Migration `0015_article_images` from the initial publisher-image release is preserved;
the next migration adds the durable queue while preserving existing image state.
The worker adopts expired attempts and retryable failures when processing resumes.
The existing release workflow applies pending migrations and deploys Modal after
an authorized merge to main and successful checks. Local validation does not
migrate production, upload assets, or enable automatic image processing.

Existing articles can be processed with the bounded
`python -m pipeline.backfill_images` command; it needs no inference credentials.
The previous `python -m pipeline.images.backfill` entrypoint remains available.
Both backfill commands target only articles added on **29 September 2026 in
Europe/London**, including dry runs, retries and replacements. This is a fixed
calendar date. The triggered worker excludes older articles while normal image
ingestion continues for articles added on subsequent days.
Image failures do not change article fetch-failure exclusions or published summaries.
A replacement preserves the previous public asset until the new one commits.

See the [image rollout and recovery runbook](../docs/images/rollout.md) for
configuration, migration order, canary, backfill, retries and operational checks.

After `npm ci` in `hacksnap/web`, run the database regression suites from the
repository root with the existing test-only embedded PostgreSQL runtime:

```sh
HACKSNAP_TEST_PGLITE_MODULE="$PWD/hacksnap/web/node_modules/@electric-sql/pglite/dist/index.js" \
  uv run --directory hacksnap pytest
HACKSNAP_TEST_PGLITE_MODULE="$PWD/hacksnap/web/node_modules/@electric-sql/pglite/dist/index.js" \
  uv run --directory data pytest
```

These tests use synthetic fixtures without production credentials. Live
publisher-to-Blob verification remains a rollout check.

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

## Workflow concurrency and timing

The scheduled image worker processes up to four jobs concurrently. Set
`HACKSNAP_IMAGE_CONCURRENCY` to 1–8 (default 4); `HACKSNAP_IMAGE_BATCH_SIZE`
remains the total attempt cap, not the worker count. Each lease is claimed only
when a worker slot is free. Lease budgets include contention for publisher pacing.
Custom settings requiring a lease above 3,600 seconds fail before queue writes;
reduce concurrency, candidates, redirects or the publisher interval.
The shared fetcher maintains per-host spacing across workers and redirects;
unrelated hosts can run simultaneously. The explicit fixed-day backfill commands
retain their sequential checkpoint behavior.

`refresh_completed`, `image_batch_completed`, and the collector's
`ingestion_completed` events report elapsed seconds, concurrency, item counts,
and items per minute. Summary throughput counts all attempted stories, including
cache hits and failures; ingestion throughput counts examined stories; image
throughput counts claimed attempts. Compare these counts and result breakdowns,
not just total duration: summaries now consider up to 50 stories per run.
`summary_job_completed` includes executor wait and processing time;
`image_job_completed` includes processing time. `inference_timing` includes
warm-up wait, request duration and total duration on success and failure. The
existing `inference_completed.elapsed_seconds` excludes warm-up waiting.
Threaded summary, image and ingestion work inherits the parent tracing context.

The image worker still starts after the summary batch completes. No change to
Modal container limits, model routing, publisher pacing or inference rate limits
is required to enable these internal workers.

## Vercel Python SDK telemetry

The pipeline disables Vercel SDK usage telemetry with
`VERCEL_TELEMETRY_DISABLED=1` before importing the SDK. This applies to local
runs and Modal workers, including both Blob adapters. Blob storage operations
continue normally. Existing workers need a deployment to pick up this change.

## Retrieved pages without article text

The summary prompt distinguishes real article body text from navigation-only pages,
bot challenges, access/login/paywall notices, and JavaScript fallback pages. When a
retrieved page is unusable, the structured output uses the fixed notice
“Article unavailable: the retrieved page did not contain usable article text.”
with no article key points. New discussion analysis does not generate reference
claims. The notice is an inference-only marker: after validation, the pipeline persists
`article_summary: null`
and `article_status: unavailable`. Existing web consumers then show unavailable copy
and the source link, and describe the page as discussion-only in preview metadata.
Available comments (and substantive HN story text) can still be summarized. True
fetch failures retain the existing `fetch_skipped` behavior.

This is a model judgment within the existing inference call, not a deterministic
pre-inference content filter. Short genuine articles remain eligible. Normal
summaries still require article content and key points. Existing saved summaries
are not regenerated automatically, so the unavailable state is retained by later
discussion-only refreshes; recovering the article requires explicit regeneration.

### Structured brief inference compatibility

Discussion opening and bullet strings keep their length limits in the JSON schema
sent to the model. Single-line validation runs in Python after generation because
the deployed xgrammar compiler rejects `pattern` combined with `minLength` or
`maxLength`. Invalid multiline output still fails validation before publication.
The persisted discussion brief remains a string with application-inserted bullets.
