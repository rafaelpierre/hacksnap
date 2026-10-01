# Archive query plan, 1 October 2026

Issue #172 adds `hn_archive_date_idx` on `(date_added DESC, hn_id DESC)`.
The archive SQL and canonical page URLs stay unchanged. The same index also
supports UTC month bounds followed by that order. The migration is applied by
the existing schema workflow after merge; it was **not** applied to production
during this investigation.

## Live baseline

Read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the Supabase database
found 244 qualifying threads. The projection selected `t.hn_id`; PostgreSQL
eliminated the unused summary join. All four Latest plans used a sequential
scan, an in-memory sort, and 18 shared buffer hits with no reads. Execution
times below exclude network, pool wait, and JSON transfer:

| Latest page | Offset | Rows returned | Execution time |
| --- | ---: | ---: | ---: |
| 1 | 0 | 31 | 0.246 ms |
| 10 | 270 | 0 | 0.262 ms |
| 50 | 1470 | 0 | 0.256 ms |
| 100 | 2970 | 0 | 0.272 ms |

September page 1 scanned 240 of the 244 rows, sorted in memory, used 18
shared buffer hits and took 0.235 ms. Production currently cannot exercise a
deep page. These observations establish the missing matching index, but show
no material live latency at the current table size.

## Representative growth test

An in-memory PGlite PostgreSQL fixture inserted 30,000 threads (three per
timestamp) and summaries for every third thread. The test projected thread
ID/title plus summary text through the same left join, order, limit, and
offset shape. `EXPLAIN (ANALYZE, BUFFERS)` was run immediately before and
after creating the index. This is a local warm-cache comparison, not a
production latency forecast.

| Listing | Page | Before | After | Before / after plan |
| --- | ---: | ---: | ---: | --- |
| Latest | 1 | 24.142 ms, 285 hits | 0.298 ms, 77 hits, 2 reads | scan + hash join + sort / ordered index scan + nested loop |
| Latest | 10 | 22.380 ms, 285 hits | 0.452 ms, 710 hits, 1 read | same |
| Latest | 50 | 21.904 ms, 285 hits | 2.102 ms, 3,532 hits, 4 reads | same |
| Latest | 100 | 22.067 ms, 285 hits | 4.031 ms, 7,061 hits, 6 reads | same |
| Filtered month | 1 | 21.754 ms, 285 hits | 0.137 ms, 81 hits, 0 reads | same |

The synthetic index occupied 958,464 bytes for 30,000 rows (about 32 bytes
per row). Each new thread or changed `date_added` also maintains this index;
write throughput was not benchmarked. The page-100 scan still advances over
2,970 index entries, so cost rises with offset. At 4 ms in this fixture, a
keyset continuation is not yet justified. If deeper pages or a larger archive
make offset costly, a bounded cursor can be added while retaining canonical
`?page=` links and the `(date_added, hn_id)` tie order.

`hacksnap/web/tests/archive.test.mjs` checks pages 1, 2, 10, 50, and 100,
equal timestamps, and a UTC month before and after index creation. Production
after-migration plans, index size, and concurrent browse behavior remain to be
measured after the schema rollout. Browser return and no-JavaScript links are
unchanged by this migration.
