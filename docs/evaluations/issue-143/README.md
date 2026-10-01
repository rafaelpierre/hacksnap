# Browse read cache fixture, issue #143

`hacksnap/web/tests/browse-data-cache.test.mjs` uses a deterministic public-story
fixture and a mocked one-connection pool. It counts SQL statements including
`BEGIN`/`COMMIT`, records connection acquisition waits with `performance.now()`,
and checks that capability grants change the projection after a cache miss using
embedded PostgreSQL. Run it from `hacksnap/web/` with Node 22:

```sh
npm test -- tests/browse-data-cache.test.mjs
```

One local run on 2026-10-01 recorded:

| Scenario | Requests | SQL statements | Pool acquisitions | Pool wait (ms) |
| --- | ---: | ---: | ---: | --- |
| Cold identical archive page, concurrent | 8 | 4 | 1 | approximately 0 |
| Warm identical archive page, concurrent | 8 | 0 | 0 | 0 |
| Four distinct archive pages, concurrent | 4 | 16 | 4 | 0, 9, 19, 29.1 |

The fixture adds an 8 ms delay to each listing query. The four distinct requests
finished in 39.4 ms in that run. Timings vary by host; the assertions cover query
and acquisition counts, same-key coalescing, hard expiry, and that the queued
distinct requests actually wait. The pre-change browse-list path required six
statements per request: transaction begin, three independent capability checks,
listing query, and commit. A cold miss now requires four. A warm hit requires none.
The test also checks that eight distinct pending loads are the shared ceiling,
the ninth fails before entering the pool, and a rejected load is retried rather
than cached as an empty result.

This is an isolated load fixture, not production latency or traffic evidence.
The live pool remains capped at one connection. Origin request rate, cross-instance
hit rate, and production pool wait remain unmeasured.
