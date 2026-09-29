# Article image rollout and recovery

Implements issue #58 and its active subissues #66–#69. Those subissues specify
1200 × 630 WebP images, Twitter/JSON-LD candidates, generated fallbacks, and stored
story social previews. The older parent text describes a narrower first phase and
preserved publisher proportions. The initial publisher-image implementation is now
on `main`; this change extends it with the newer subissues. Existing ready assets
retain their URLs and dimensions; newly processed images use 1200 × 630.

## Storage and publication

Image metadata lives on `hacker_news_threads`, keyed by the existing `hn_id`.
Existing rows have null image metadata and remain readable. The worker stores the
actual public Blob URL, source type, original publisher image URL, dimensions,
MIME type, and pending/ready/failed state. Generated images have null source URLs.
Original publisher URLs remain private to the worker because they can contain
signed query values. The website renders only ready canonical assets; it never falls back to publisher
URLs. Runtime load failures use the site's image fallback.

Image work has its own durable claim and retry lifecycle. Article summarization
commits before image handoff. Each completed Modal summary run asynchronously
starts a bounded image sweep, including quiet runs with no new summaries. The next
completed run recovers jobs if dispatch fails or a worker stops. Image failures
never enter the article fetch failure table and never remove a story from ranking. Claims use expiring leases;
completion checks the lease token to reject stale workers.

Blob uploads use unique URLs beneath `articles/<hn_id>/hero.webp`. Replacements
preserve the existing ready image until a replacement commits. Never overwrite a
public object in place: browsers and social crawlers may cache it. Old published
URLs must remain usable while those caches expire.

## Configuration and deployment order

1. Create a **public** Vercel Blob store and put its `BLOB_READ_WRITE_TOKEN` in the
   existing server-side Modal `hacksnap` Secret. Never set a `NEXT_PUBLIC_` token.
   The frontend needs no Blob write credential.
2. Apply migrations through `0016_image_queue` using the repository's existing
   Alembic schema workflow. The original `0015_article_images` migration is unchanged. Verify its reader grants and migration head. Run against the
   intended environment; local tests never apply production migrations.
3. Deploy the worker with `HACKSNAP_IMAGES_ENABLED=false` initially. Deploy the
   frontend. Existing null metadata should retain the existing image-less layout.
4. Use the dry run below, then process a small explicit batch. Inspect stored
   metadata and load each canonical Blob asset directly. Verify homepage, story,
   social preview, and runtime image failure behavior.
5. Set `HACKSNAP_IMAGES_ENABLED=true` in the worker environment and deploy the
   worker when ready to enable automatic image ingestion. The enabled worker
   requires a valid Blob token. Monitor outcomes before expanding the backfill.

Local maintenance needs only `HACKSNAP_DATABASE_URL` (or `SUPABASE_PASSWORD`) and,
for writes, `BLOB_READ_WRITE_TOKEN`. It does not need inference credentials.
Load credentials from the normal private environment file without printing them.

### Image processing limits

The existing `refresh_article_images` Modal function is triggered after
`refresh_hacksnap` completes, with one container and ten processed jobs per
invocation by default (configurable up to 100). It has no separate schedule;
automatic runs follow summary starts from 09:00 through midnight in Europe/London,
including completion of the midnight run. Deploying removes the old image cron.
Dispatch failures are logged without failing summary publication; recovery waits
for the next completed summary run. Its disabled flag is checked before database
access. Enabling it without a Blob token raises a configuration error. Publishers
are limited to one request every two seconds by default in that sweep; backfill uses the requested
publisher interval, including image candidates and redirects.

| Environment variable | Default | Accepted range |
| --- | --- | --- |
| `HACKSNAP_IMAGE_BATCH_SIZE` | 10 jobs | 1–100 |
| `HACKSNAP_IMAGE_PUBLISHER_INTERVAL` | 2 seconds | 0–10 seconds |
| `HACKSNAP_IMAGE_TIMEOUT` | 8 seconds of network time | 1–30 seconds |
| `HACKSNAP_IMAGE_MAX_BYTES` | 8,000,000 bytes | 1,024–16,000,000 |
| `HACKSNAP_IMAGE_MAX_HTML_BYTES` | 1,000,000 bytes | 1,024–2,000,000 |
| `HACKSNAP_IMAGE_MIN_WIDTH` | 600 pixels | 300–2,400 |
| `HACKSNAP_IMAGE_MIN_HEIGHT` | 300 pixels | 150–1,200 |
| `HACKSNAP_IMAGE_MAX_CANDIDATES` | 12 | 1–20 |
| `HACKSNAP_IMAGE_MAX_REDIRECTS` | 3 | 0–5 |
| `HACKSNAP_IMAGE_MAX_ATTEMPTS` | 3 | 1–10 |

The previous `HACKSNAP_IMAGE_TIMEOUT_SECONDS` and
`HACKSNAP_IMAGE_HTML_MAX_BYTES` names remain aliases; the names above take
precedence when both are set. Lease duration is calculated from the bounded
request budget; the former fixed lease/retry settings no longer control the queue.
Use a positive publisher interval for live requests.

Decoded images are capped at 30 million pixels. Courtesy waits are separate from
network time; the lease duration covers both, plus a processing margin. Source
JPEG, PNG, WebP and GIF images become 1200 × 630 WebP at quality 84. Animated
images use the first frame. Generated artwork uses installed Noto fonts on Modal;
unsupported emoji are replaced with a visible star marker.

## Bounded backfill

The authorized backfill is limited to articles added on **29 September 2026,
Europe/London**, using the canonical `hacker_news_threads.date_added`. Its fixed
bounds are `2026-09-29 00:00 BST` inclusive and `2026-09-30 00:00 BST` exclusive:
`2026-09-28T23:00:00Z <= date_added < 2026-09-29T23:00:00Z`.
Both CLI entrypoints enforce this window during selection, queue handoff, lease
recovery and claim. `--include-failed`, `--reprocess-ready` and `--after-id` do not
widen it. Running tomorrow still targets 29 September; there is no moving
"today" default. Results report the date and timezone alongside the counts.

The triggered worker and summary handoff exclude articles added before
29 September. Normal image ingestion continues for articles added on later days;
the one-day upper bound applies to backfill commands.

Run from the repository root:

```sh
# Read-only selection; no fetch, upload, claim, or inference call.
uv run --directory hacksnap python -m pipeline.backfill_images --dry-run --limit 5

# Small canary: at most five stories, sequential jobs, two-second publisher spacing.
uv run --directory hacksnap python -m pipeline.backfill_images --limit 5

# Continue in bounded batches after validating the canary.
uv run --directory hacksnap python -m pipeline.backfill_images --limit 25 --publisher-interval 2
```

The default run selects missing assets, skips ready images, and uses the same
processor as new ingestion. Batch size is 1–100; publisher spacing is 1–10 seconds.
Only one job is claimed at a time, after its publisher wait. Each completed ready
record is a durable checkpoint. The JSON result includes selected, processed,
publisher-derived, generated, failed, skipped, and `next_after_id` totals.

A successful command exits zero; any failed story exits one after the remaining
batch has run. An interruption leaves the current claim to expire; restart from
the default cursor to recover it while attempts remain. A crash on the final
permitted attempt is marked failed by the next sweep; explicitly use
`--include-failed` after fixing the cause to start another bounded retry cycle. `--after-id <hn_id>` is available for explicit
ascending scans. Always do a final pass from zero, because a skipped or
interrupted earlier job may still need recovery.

Run one backfill command at a time. Disable automatic image handoffs
(`HACKSNAP_IMAGES_ENABLED=false`) and let active image runs finish before bulk
backfilling if publisher pacing must hold across all workers. Claims prevent
duplicate completion, but a command's pacing applies only to that command.

## Recovery

- **Publisher failures:** metadata, HTTP, decoding, or size failures advance to
  the next candidate. Exhausted publisher candidates produce branded artwork.
  Generated success counts separately from publisher-derived success.
- **Blob outage:** published stories remain available. Retryable image failures
  stay observable and are bounded by the queue's attempt cap and retry delay.
  Repair credentials/storage before requesting more work.
- **Expired lease:** the next summary-triggered sweep or backfill recovers the
  pending job after lease expiry while attempts remain. Exhausted jobs become failed and
  require an explicit retry. A stale worker cannot replace a newer job's result.
- **Exhausted failures:** after fixing the cause, explicitly reset the selected
  failures with `--include-failed --limit 5`. Do not schedule an endless loop with
  this flag, because it deliberately starts a new bounded retry cycle.
- **Replace a ready image:** use `--reprocess-ready --limit 5`, optionally with
  `--after-id` to narrow an ascending scan. Review dry-run selection first. The
  current ready URL remains visible until a new upload and metadata write succeed.
- **Upload succeeded but persistence failed:** unconfirmed database outcomes
  retain the new object for reconciliation, avoiding deletion of an asset a reader
  may use. An explicit stale-lease rejection allows deletion of that unused upload.
  Cleanup diagnostics identify this case. Inspect the authoritative stored URL
  before manually deleting an orphan; never delete the currently referenced URL.

### Retrying generated fallbacks after the downloader fix

A completed download with `Content-Length` and `Connection: close` previously
could raise `Bad file descriptor` on the next loop iteration. Logs reported
`fetch_network_error`, and the worker stored generated artwork as a ready image.
The fixed downloader stops at the completed HTTP response before touching the
closed socket. Existing generated images stay ready, so ordinary runs skip them.

After deploying the fix (or updating the local checkout used by the CLI), preview
and then reprocess a small batch from the repository root:

```sh
uv run --directory hacksnap python -m pipeline.backfill_images --dry-run --reprocess-ready --limit 5
uv run --directory hacksnap python -m pipeline.backfill_images --reprocess-ready --limit 5
```

Inside `hacksnap/`, omit `--directory hacksnap`. These commands still enforce the
fixed 29 September 2026 London window. `--reprocess-ready` includes all eligible
ready images in that batch, including publisher images. Verify `publisher_derived`
and per-article `source_type` after the run. The existing asset remains available
until a replacement commits; the normal site cache can delay its appearance.

## Validation before enabling broad processing

Use representative Open Graph, Twitter, JSON-LD, no-image, invalid-image,
fetch-failure and upload-failure cases. Automated fixtures cover these paths
without live publishers or production credentials.

For a real canary, verify:

- Every ready URL is a public Blob URL and decodes as WebP with stored dimensions.
- Publisher source type/URL match the chosen metadata; generated provenance is null.
- Browser network requests and Open Graph/Twitter metadata use canonical assets.
- Missing, pending, failed and runtime-broken images leave usable pages.
- An interrupted job resumes after lease expiry while attempts remain; an
  exhausted job becomes visibly failed. Ordinary reruns preserve ready assets.
- Ranking and published summaries are unchanged by image failures.
- Logs carry story identity, safe URLs, source type, status and distinct failure
  reasons. Query values and exception response bodies must not appear.

Deployment, real Blob uploads and production backfill are separate rollout steps;
passing local tests does not establish those checks.

## Local verification

The worker and frontend suites cover metadata fallbacks, network protection,
decoding, publication isolation, private grants, leases/retries, UI errors and
social previews. Ingestion CI installs the locked embedded PostgreSQL runtime
and executes the real migration and worker SQL lifecycle tests without a server
or credentials. [Browser and artwork evidence](screenshots/README.md) records the
fixture checks; live Blob delivery remains a canary step.
