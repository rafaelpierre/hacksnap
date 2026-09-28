# Pending summaries: 28 September 2026

## Production findings

Read-only database inspection at approximately 19:24 UTC found 7 pending stories
in the worker's current top 10. Three had failed inference at 16:00 UTC; the other
four arrived after that run. Their raw source was still retained.

The deployed schedule was 08:00, 12:00, 16:00 and 20:00 UTC, matching the repository.
The 16:00 run attempted 12 stories: 0 generated, 2 unchanged, 5 failed inference,
2 article fetch failures and 3 unavailable sources. All five inference failures
followed responses with `completed: false` and exactly 8,000 completion tokens.
These were three initial summaries and two discussion refreshes. The worker rejects
incomplete output, leaving new stories pending and preserving existing summaries.

Across all 185 eligible ranked stories, 75 lacked summaries. Of those, 50 had no
retained source; all 50 were more than seven days old, consistent with source expiry.
The worker selects only the current top 10, so historical pending stories are not
a backlog that it automatically drains. A higher frequency cannot recover expired
inputs or guarantee generation for stories that never enter the top 10.

Per-story failures are caught and counted. The function returns normally after rank
history and cleanup, so a successful Modal invocation does not mean every summary
was generated. Monitor the `failed` count in `refresh_completed` as well.

## Change

- Run hourly at 09:00 through midnight inclusive in `Europe/London`, 16 runs daily.
  The explicit IANA timezone follows GMT/BST.
- Increase the completion budget from 8,000 to 32,000 tokens, including reasoning.
  Keep existing response completeness, schema and source validation.
- Preserve selection, source retention and inference timeout behavior. No backfill
  or database migration is included.

## Local validation

- Worker: 206 tests passed, Ruff passed, Modal module import passed.
- Ingestion: 62 tests passed, one skipped.
- Frontend under Node.js 22: lint, formatting, 171 tests, typecheck and build passed.

## Live validation

A temporary Modal probe reused the worker image, configured endpoint and normal
validation path with read-only database transactions and no-op write methods.
No generated content or credentials were logged or saved by the probe.

At a 16,000-token cap, four of the five previously failing stories passed:

| Story | Operation | Completion tokens | Result |
| --- | --- | ---: | --- |
| 49868830 | Discussion refresh | 8,131 | Valid |
| 49872723 | Initial summary | 11,723 | Valid |
| 49873241 | Discussion refresh | 8,688 | Valid |
| 49874728 | Initial summary | 16,000 | Truncated |
| 49877988 | Initial summary | 9,733 | Valid |

The completed calls took 25–44 seconds; the truncated call took 50 seconds.
This motivated the final 32,000-token allowance. These are individual live samples,
not a guarantee against future truncation or a semantic-quality benchmark.

A second probe retried story 49874728 with the 32,000-token allowance. It completed
in 43 seconds using 9,877 completion tokens and passed initial-summary validation.
Output length varies between generations; this successful retry does not establish
that every response needs more than 16,000 tokens. All five previously failing
stories produced valid output across the two probes. Neither probe wrote summaries.
