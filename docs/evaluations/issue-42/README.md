# Comment analysis rollout — issue #42

## Release state

The production schema was upgraded from `0011_categories` to
`0013_discussion_retention` on 2026-09-27. Reader grants allow analysis, public
coverage and analysis time; private metadata and the retention acknowledgement
remain inaccessible. Immediately afterwards, all 105 summaries still had null
analysis. The migrations performed no historical processing.

- [Schema deployment](https://github.com/rafaelpierre/hacksnap/actions/runs/36318474361)
- [Initial worker deployment](https://github.com/rafaelpierre/hacksnap/actions/runs/36318523839):
  Modal `hacksnap` v5, commit `c46c323`, deployed at 12:19 UTC.
- [Read-only preflight](production-preflight.json) and
  [post-migration verification](production-post-migration.json).

The initial worker deployment uses the v5 initial/v1 refresh prompts. This PR
corrects semantic defects found during release evaluation with v6 initial/v2
refresh prompts. The rendering fallback in this PR requires a frontend deployment.

**Issue #42 stays open until a small batch from normal processing has been
reviewed in production.** No manual refresh, historical article fetch, backfill
or database data rewrite was performed for this evaluation. Token-usage work is
deferred at the user's request.

## Repeatable semantic evaluation

From `hacksnap/`, using the existing Modal CLI credentials:

```sh
uv run python -m pipeline.evaluate_discussion \
  --base-url https://rafaelpierre--ep-deepseek-v4-1-flash-server.us-west.modal.direct/v1 \
  --model deepseek-ai/DeepSeek-V4.1-Flash --modal-cli \
  --output /tmp/discussion-evaluation.json
```

The output path must not exist. Repeat `--case <fixture-id>` to select cases.
Alternatively set `MODAL_LLM_API_KEY` and omit `--modal-cli`.
The runner uses the actual production schemas, prompts and source validators.
It sends synthetic inputs only, uses a neutral title, and never connects to the
database or invokes ingestion, the worker loop or cleanup. Each result is saved
before the next request. One failed response does not prevent later cases.
Errors contain only their type, with no provider bodies or credentials.

The suite makes 24 calls: initial generation and comment-only refresh for all
12 contract fixtures. Refresh uses established fixture claims to isolate its
behavior from initial claim extraction. Schema/source validation passing does
not imply semantic correctness; review the actual output against the supplied
text and `semantic_expectations`. This tiny sample cannot establish performance
on dense or adversarial real discussions.

### Recorded results

The [baseline v5/v1 run](semantic-results.json) passed 23/24 structural checks;
the unavailable-source initial response was rejected. It also reproduced wrong
topic keys and omitted qualifications despite passing schema checks.

The [revised v6/v2 run](semantic-results-v6.json) passed 24/24 structural/source
checks. Source-by-source review of the selected highlights and themes found:
- one-sided criticism and sparse support stay one-sided;
- sarcastic criticism and a reply supporting the original claim keep their direction;
- concurrency qualifications survive both generation and refresh;
- neutral questions and ethical concerns do not become stance evidence;
- the cost objection targets the cost claim once and preserves agreement with latency,
  using qualified disagreement in both initial and refresh;
- replication/methodology use evidence, RAM uses technical limitations, workload
  scope uses applicability, and consent/deletion use ethics/privacy;
- no-comments, unavailable-source and open-question states remain distinct;
- HN text supplies claims when no article is available.

These are single stochastic samples of tiny synthetic inputs, reviewed by Codex.
They do not guarantee semantic accuracy on production stories. Topic granularity
can vary (a qualified comment can support both applicability and constraints).
No model-based judge or claim of exhaustive comment classification is used.

| Revised run (12 requests each) | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Initial wall time, seconds | 5.751 | 9.223 | 11.517 |
| Refresh wall time, seconds | 3.078 | 6.410 | 10.039 |
| Initial JSON characters | 775 | 1,457.5 | 1,862 |
| Refresh JSON characters | 106 | 725 | 1,067 |

Timing includes CLI authentication and request overhead; it excludes fetches and
database writes. Lengths count compact JSON characters. These are not production
latency measurements.

### Semantic corrections

The prior prompts allowed replication, concurrency and throughput to receive
`social_impact` or vague `other` labels. A multi-claim refresh rejected the cost
claim but omitted the comment's explicit acceptance of the latency result.
Some sparse inputs produced overlapping themes or inferred limitations.

Both prompts now define every topic key, require the most specific supported
category, distinguish engineering constraints from social effects, and discourage
invented/overlapping themes. Comments accepting one claim while rejecting another
retain both positions as qualified disagreement. Initial claim extraction also
preserves source scope without turning a limited experiment into a claim that a
result works only in that setting. Prompt versions change to invalidate the
analysis cache for eligible new-format rows; legacy rows remain ineligible.

## Integration evidence

- Worker suite: 206 passed, including all shared fixtures, unchanged-input caching,
  changed comments outside the sentiment sample, missing retained source,
  concurrent-write rejection, failure isolation and last-valid-analysis preservation.
- Ingestion suite: 62 passed, one opt-in integration test skipped.
- Frontend: 156 tests passed, plus lint, formatting, TypeScript and credential-free production build
  pass on Node 22. The suite includes embedded PostgreSQL reader projection/grant
  checks, shared fixture rendering, source links, legacy rendering, outage handling
  and the explicit rendering fallback.
- These suites use mocks or embedded PostgreSQL where stated. They do not establish
  that a newly generated production row has reached the deployed website.

Caching at the checked revision: story and homepage HTML are forced dynamic
following the outage fix; the shared leaderboard data cache still revalidates every
1,800 seconds. React's story cache is request-scoped. The fallback changes the
leaderboard cache namespace and separates enabled and disabled deployments.
Cloudflare must continue bypassing HTML and negotiated Markdown routes.

## Deployment and recovery

1. Apply the existing `supabase-schema.yml` workflow from the intended release
   revision. It validates the migration graph and runs ingestion tests first.
   Confirm `0013_discussion_retention` before deploying writers. Verify the three
   public reader grants and denied private columns as in the recorded preflight.
2. Deploy the matching collector and enrichment worker. Collector ingestion and
   worker cleanup must both respect the discussion content acknowledgement.
   The `hacksnap.yml` manual workflow runs tests and independently checks the
   database revision before deploying. Do not invoke `refresh_hacksnap` to test
   deployment. Its normal schedule is 08:00, 12:00, 16:00 and 20:00 UTC.
3. Deploy the web reader after the additive schema. Verify a legacy story, an
   analyzed story when available, and HTML/Markdown responses for the same ID.
   The missing-column fallback prevents an outage but does not replace migration
   and permission verification.
4. Review the next normal batch: at least three newly summarized stories if
   available, including a sparse and a denser sample. Record IDs, analysis time,
   selected source links and actual caveats. Check every highlight against its
   original target, every topic against its cited comments, and empty/one-sided
   groups. Inspect error events and later successful stories. Observe an unchanged
   and changed-input refresh; confirm article summary and generation time persist.
   Do not fill the sample by reprocessing historical rows.
5. Seven-day source expiry remains in effect. Missing source is unavailable and
   preserves analysis. Cleanup waits for acknowledgement on new-format rows;
   the migration itself performs no cleanup. Do not invoke cleanup for verification.

### Disable generation

Emergency fallback, from `hacksnap/`:

```sh
uv run modal app stop hacksnap
```

This stops the app and terminates in-flight containers. It also pauses summary,
sentiment and rank-history processing; ingestion is a separate app. Committed
summaries and valid analysis stay in PostgreSQL. An interrupted transaction rolls
back; inspect completion logs before resuming. The CLI command was verified with
`--help`; intentionally stopping production was not rehearsed.

Resume by redeploying the tested worker revision through `hacksnap.yml` after
checking schema and collector compatibility. Leave the additive schema in place.
Do not downgrade migrations, null analysis columns, or run a backfill as rollback.

### Disable rendering

Set server-only `HACKSNAP_DISCUSSION_RENDERING=false` in the frontend deployment
environment and redeploy this PR's web version. All story/feed/archive/category
loaders use their legacy projection; story pages show the existing discussion
summary and points. API/Markdown receive no analysis through those loaders.
The worker and stored data are unchanged. Disabled deployments use a separate
leaderboard cache key, preventing an enabled cached projection from resurfacing.

Remove the setting (or set `true`) and redeploy to restore analysis. The fallback
test covers every loader, verifies that no analysis capability read or mutation
occurs, and checks re-enabling. This is an operational fallback, not a runtime
per-user preference.
