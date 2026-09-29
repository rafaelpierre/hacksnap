# Article image backfill

The image worker reads image-less rows from `hacker_news_threads` and processes one bounded batch per run. The hourly Modal job uses the same path. Image processing is independent of article and discussion summaries.

## Before running

- Apply migration `0015_article_images` and configure the worker's existing database credentials plus `BLOB_READ_WRITE_TOKEN`. The CLI needs no LLM credentials. Keep the Blob token server-side; the website does not need it.
- Run only one image worker at a time. The local CLI spaces requests to each publisher hostname (including redirect targets); Modal is configured with `max_containers=1`. Do not overlap a CLI run with the scheduled job, since each process has its own rate limiter.

## Rollout checklist

1. Start with an authorized small batch: `uv run --directory hacksnap python -m pipeline.images.backfill --limit 3`.
2. Review the CLI summary (`scanned`, `ready`, `failed`, `skipped`, `superseded`, and `failure_reasons`) and structured `article_image` logs. Investigate failure reasons before expanding the batch.
3. For ready rows, inspect the canonical public Blob URL, HTTP availability, image dimensions, status, MIME type, and retained publisher provenance using authorized operational access. Provenance and retry diagnostics are private and are not sent to the website.
4. Check representative story cards and detail pages with ready images. Also check a failed or image-less story; its existing layout should remain usable. Allow for the site's normal cache/ISR delay before judging a newly ready image's public rendering.
5. Rerun a small batch and confirm ready rows are skipped. Expand the batch only after URL, metadata, rendering, failure handling, and logs look correct.

The CLI scans candidates once per run, so it will not repeatedly retry one failure in that batch. A claim has a lease (900 seconds by default); after interruption, a later run can reclaim an expired lease while attempts remain. Attempts are bounded (three by default), and failed rows cool down for an hour by default before retry. Rows exhausted at the attempt limit stay failed: investigate the individual row and its reason, then have an operator reset only that row through the approved database operations process before retrying. Do not bulk-reset failures.

`--limit` accepts 1–100; omitting it uses `HACKSNAP_IMAGE_BATCH_SIZE` (default 10). Host spacing defaults to `HACKSNAP_IMAGE_PUBLISHER_INTERVAL=2` seconds. Other retry, lease, and image limits are documented in `.env.example` and `hacksnap/README.md`.

Code-task validation used local synthetic fixtures only. No production backfill, public Blob inspection, or production rendering check has been performed.
