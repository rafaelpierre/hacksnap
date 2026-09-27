# Issue #75: public database work

Reviewed on 27 September 2026 against main `f5900e3`, then rebased onto
`de9d40d` while preserving schema fallback, recoverable outage handling, and
the added public discussion-analysis fields.

## Changes

- Public story detail selects only the public contract through the thread and
  summary primary keys, including the public discussion fields added in #81.
  A schema/grant check on cache misses preserves the unmigrated-schema fallback.
  Ranking/history queries remain exclusive to renderers
  that display those fields.
- Per-instance caches have hard TTLs, entry limits, pending-load limits, same-key
  coalescing, safe negative caching, and no cached failures. Exact limits and
  combined freshness delays are documented in `hacksnap/web/README.md`.
- Archive/category pages are limited to 1–100, with validation before data access
  and inside query builders. Offset cannot exceed 2,970. This retains existing
  numbered URLs and bounds skipped rows to fewer than 3,000; archive months remain
  available. Category lists intentionally stop at their latest 3,000 entries.
  Cursor pagination is needed if deeper category access becomes a requirement.
- RSS gains cached data, explicit HTTP freshness, and sanitized failure responses.
  Markdown keeps `no-store` and `Vary: Accept`; underlying story reads are cached.

No schema, production configuration, or deployment changes were made.

## Unit regression coverage

Tests use injected clocks, mocked PostgreSQL clients, and mocked data providers.
No new integration tests are included. Coverage checks:

- Existing response fields, pending summaries, invalid IDs, safe 404s, sanitized
  failures, and response caching headers.
- Three same-ID detail calls share one schema/grant check and one minimal data read. Three missing-ID calls
  issue one read. Two failed calls attempt two reads. Three rendering calls and
  three RSS calls each issue one separate cached read.
- Positive/negative expiration, eviction, same-key concurrency, and pending-load
  admission limits.
- Oversized pages fail before connection acquisition; query builders reject
  oversized offsets and the last permitted page does not advertise a next page.
- Markdown negotiation headers, direct handler requests, HEAD, and RSS failures.

Existing embedded-Postgres tests are excluded from local validation for this
change at the user's request. Browser and HTTP integration checks are not part
of this regression work.

## Exploratory query comparison

Before the unit-only test scope was requested, a one-off local embedded-Postgres
experiment compared the old detail query with the minimal query. Its test was
removed from the change. No production queries or load tests were used.

The synthetic fixture contained 10,000 eligible stories, 9,999 summaries and
169,832 ranking observations, including 2,000 for the target story. It used the
ranking view from migration `0007_rank_history`, both existing history expressions,
and the existing detail projection. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` showed:

| Query | Observed work |
| --- | --- |
| Existing detail | Rank WindowAgg over 10,000 stories; history WindowAgg over 2,000 target observations; additional recent-history read |
| Minimal public detail | Two primary-key index scans, one thread row and one summary row; no ranking/history work |

One local execution measured about 150 ms versus 0.055 ms. These embedded-runtime
numbers describe that fixture only and are not a production latency estimate.
The serialized public responses matched for summarized, pending, and absent IDs.
This experiment predates #81; the final projection also returns its public
discussion-analysis fields and checks their availability before each cache miss.

## Deployment verification and remaining exposure

Only read-only configuration inspection and two individual HEAD requests were
performed. No rate-limit threshold was exercised.

- Cloudflare `GET /zones?name=hacksnap.live` succeeded but returned zero accessible
  zones with the available token. Zone rate-limit rules and origin DNS could not
  be inspected. This does not establish that rate limiting is absent.
- The repository's scanner Worker blocks selected probe paths and forwards
  legitimate routes. Its configuration contains no request-rate limiter.
- A HEAD request to `https://hacksnap.live/` returned 403 from this environment.
  That single response does not prove rate-limit coverage for legitimate routes.
- GitHub's latest successful Production deployment at inspection time (deployment
  `6691978750`) pointed to
  `https://lighthouse-hacker-news-j5atl7wpv-hacksnap.vercel.app`. A HEAD request
  redirected to Vercel login/SSO. This confirms access protection on that deployment
  URL only. Production aliases and custom-origin bypass paths remain unverified.

Before declaring the deployment protected, an operator with zone/project access
must inspect the active Cloudflare `http_ratelimit` rules for the public API,
story/Markdown, RSS, archive and category routes; verify thresholds/actions and
any bypass conditions; and check every Vercel production alias and direct-origin
path. Use the [Cloudflare rate-limit API documentation](https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/)
for read access to the phase entrypoint. Record the configuration evidence without
load-testing production.

Cold-instance fan-out, cache churn across many IDs, uncached archive/category
counts, and rendering metric cache misses still create database work. Local
cache/admission bounds reduce repeated work but cannot provide a fleet-wide
request-rate guarantee. The deployed rate-limit verification acceptance item
remains open.

## Validation results

Node.js 22.23.3:

- `npm ci`, lint, formatting, type checking, and production build passed.
- `npm run test:ci -- --testPathIgnorePatterns=discussion-projection.test.mjs --testNamePattern='^(?!leaderboard fills ten preview-ready)'`:
  26 suites, 167 tests passed; one existing embedded-Postgres case was skipped. This also excludes the pre-existing discussion-projection integration suite; all new regression tests use mocks and need no database.
- `git diff --check` passed.
