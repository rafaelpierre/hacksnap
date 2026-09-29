# Article image backfill

The publisher-image backfill now uses the durable image queue, shared with the
independent `refresh_article_images` Modal worker. That worker runs every ten
minutes when `HACKSNAP_IMAGES_ENABLED=true` and a server-only Blob token is set.

Apply migrations through `0016_image_queue` before using the updated worker. The
original `0015_article_images` migration is unchanged. Existing ready images keep
their public URLs and dimensions; new images use the 1200 × 630 WebP pipeline.

Both backfill commands are restricted to articles whose canonical `date_added`
falls on **29 September 2026 in Europe/London**. The fixed window is inclusive at
`2026-09-29 00:00 BST` and exclusive at `2026-09-30 00:00 BST`
(`2026-09-28T23:00:00Z` through `2026-09-29T23:00:00Z`). Rerunning on another
day does not change this selection. Dry runs, cursor scans, retries and explicit
replacements all retain that boundary.

The scheduled worker excludes articles added before this window starts. It can
still process newly added articles on subsequent days through normal ingestion.

The existing command remains available:

```sh
uv run --directory hacksnap python -m pipeline.images.backfill --limit 3
```

For dry runs, cursor-based scans and explicit retry/replacement controls, use:

```sh
uv run --directory hacksnap python -m pipeline.backfill_images --dry-run --limit 3
uv run --directory hacksnap python -m pipeline.backfill_images --limit 3
```

Both entrypoints process bounded batches with the same queue and processor.
Default runs skip ready images. Open Graph, Twitter and JSON-LD candidates are
tried before generating branded artwork. Publisher and generated outcomes are
reported separately. The CLI needs database and Blob credentials, but no inference
credentials. Dry runs require only database access.

Follow the [rollout and recovery guide](images/rollout.md) for configuration,
canary checks, publisher pacing, interrupted jobs, exhausted retries and safe
replacement. Run one backfill at a time and pause the scheduled image worker
while backfilling when pacing must hold across processes.

Local validation uses synthetic fixtures. Production migration, real Blob uploads
and a production backfill require their own authorized rollout.
