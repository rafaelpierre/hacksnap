# Modal prompt-cache investigation: 29 September 2026

## Production evidence

The user supplied the DeepSeek V4.1 Flash Endpoint Responses export. All 13
worker requests from 14:39:46 through 14:40:44 London time reported zero cached
prompt tokens. The same export includes zero-cache worker requests at 13:01–13:03,
before PR #102 deployed at 14:38:13 (worker v14, commit `4767715`). The export's
nonzero entries at 14:46–14:47 came from the diagnostic requests below.

PR #102 changed inference scheduling, not the prompts, request body, or
run-scoped `Modal-Session-Id`. Each operation has its own fixed system prompt:
initial summary, discussion refresh, and sentiment. The deployed worker used
one completion gate for all three. The first post-deployment inference was a
discussion refresh. All eight summary requests then started before the first
summary completed, so no completed summary request warmed their shared prefix.

The endpoint is a Modal **Shared Endpoint**. Modal documents session affinity
as best effort: scaling, container replacement, or overload can reroute requests.
Neither a shared session ID nor a completed warm-up guarantees a cache hit.

## Live diagnostic results

Tests used synthetic content and the repository's summary prompt and JSON schema.
They did not read or modify production stories, change endpoint settings, or
redeploy the scheduled worker. Only usage counters and response IDs were retained.

| Experiment | Observed cache reuse |
| --- | --- |
| Three sequential requests, then four concurrent requests, then one sequential request; 32-token output cap | 6/8 responses reported 2,304 cached tokens, including all four concurrent requests |
| Discussion warm-up followed by 15 concurrent summaries; 128-token output cap | 7/15 summary requests reported 2,304 cached tokens |
| Summary warm-up followed by 15 concurrent summaries; 128-token output cap | 14/15 subsequent summary requests reported 2,304 cached tokens |
| Three sequential requests inside Modal using the worker's saved bearer token; 32-token output cap | 3/3 reported 2,304 cached tokens |
| Three sequential requests with the same token split into Modal-Key/Modal-Secret headers | 2/3 reported 2,304 cached tokens |
| Three completed synthetic summaries inside Modal using the worker's bearer token, configured model/reasoning setting, and 32,000-token output cap | 3/3 reported 2,304 cached tokens and finished normally |

The two 15-request experiments used separate session IDs and a unique, stable
experiment marker at the start of each group's system prompt to avoid reusing
cache entries from the earlier tests. The source title varied between requests.
The marker and tiny sources make these controlled comparisons, not replays of
the production workload. Requests capped at 32 or 128 output tokens ended at the
limit; the final three full-budget requests finished normally with 1,038–1,322
completion tokens. The final full-budget test used the unmodified system prompt.

## Change and limits

Track warm-up completion separately for each system prompt, schema class, and
schema name. Serialize cold warm-ups and reuse their real results. Requests for
already-warmed combinations retain concurrency. Only each combination's first
request acquires the global warm-up lock; its followers wait on a per-combination
event, so another cold warm-up cannot delay their release. Keep the 15-story concurrency
limit, 50-story run cap, session affinity, and failure-release behavior.

Synchronization-based regression tests cover a completed discussion/sentiment
warm-up followed by a summary burst, successful and failed summary warm-ups,
cache hits, missing content, and bounded story processing.

This fixes the demonstrated cross-prompt warm-up gap. The controlled comparison
supports better reuse, but it does not reproduce or fully explain the historical
all-zero interval. Authentication and the production response budget both allow
cache reuse. No backend routing trace was available to attribute individual
misses to a particular replica or eviction. Production cache-hit rates after
rollout remain to be verified in Modal telemetry.

Sources: [Modal session affinity](https://modal.com/docs/guide/endpoints#session-affinity),
[Shared Endpoint routing](https://modal.com/docs/guide/shared-endpoints#request-routing).
