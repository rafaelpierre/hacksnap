# Search metadata and RSS

## Typography

Bricolage Grotesque at weight 600 is used for headlines and the wordmark. Source
Sans 3 is used for reading text, navigation and labels. Article copy is 18px on
desktop and 17px on phones, with a 1.7 line height. Monospace is reserved for
code and compact numeric details.

The variable WOFF2 files and their licenses live in `app/fonts`. `next/font/local`
serves and preloads the fonts with `font-display: swap` and adjusted fallbacks;
builds and visits do not need an external font service.

## Color theme

The Appearance select in the header offers System, Light and Dark. System is the
default and follows OS changes immediately through CSS `color-scheme` and
`light-dark()`, including before hydration and when JavaScript is disabled.
Explicit choices are stored under `hacksnap-theme`; an inline head script applies
them before paint, including on cached pages. Existing light/dark preferences
continue to work. Invalid values fall back to System. If storage is blocked,
switching still works for the current page session. Other tabs follow saved
preference changes and reset to System when the preference is cleared.

## Shared design foundations

Home, archive and category feeds show topic navigation on the left at desktop
widths, with decorative Lucide icons beside each label. Below the existing 50rem
breakpoint, the sidebar is hidden and topics remain available through the header.

`app/globals.css` owns the semantic theme colors, relative type scale, spacing,
page/reading widths, responsive gutters and 44px (2.75rem) control target. Use
`--ink` for headlines, `--prose` for reading, `--muted` for metadata, `--accent`
for copper emphasis and `--positive` for restrained green details. Use `--line`
for separators and `--control-line` for visible control boundaries. Both themes
share the type, space and layout tokens; future component work should reuse them.
Text uses rem units and wrapping layouts to respect enlarged browser text.

Run `npm run test:theme`, `npm run typecheck` and `npm run build`. Check the shell,
feeds and story at 320px and desktop widths in both themes, including 200% text,
keyboard focus, OS appearance changes, saved preferences and blocked storage.

## Story URLs

Existing stories retain `/story/<hn-id>` permanently. Migration `0014_story_slugs`
adds a nullable stored slug without backfilling any existing row. After the updated
collector is deployed, only first inserts receive `/story/<headline>-<hn-id>`.
Refreshes preserve the stored value, including NULL for older stories, so headline
edits never change either kind of URL. Headlines are normalized to lowercase ASCII,
capped at 80 characters, with `story` as the fallback when no ASCII letters or digits remain.

Every public link uses the stored slug or falls back to the numeric ID: feed and
related stories, sharing, metadata, social images, Markdown, RSS and the sitemap.
Missing column/grant detection lets the website run before the migration; it uses
numeric URLs until the column is readable. The leaderboard cache version changes
to discard older projections. RSS GUIDs and the public API's numeric IDs remain stable.

Alternate URLs redirect to the saved canonical address; an older story's numeric
URL renders directly. Markdown GET/HEAD return 308. HTML uses Next.js permanent
redirects, preserving query parameters; when streaming has started, Next.js emits
its standard browser redirect. Routing still resolves the ID at the end of the slug.

Apply migration 0014 before deploying the updated collector. Roll out the website
before the collector to ensure newly inserted slugs are used immediately. No backfill
or production migration is performed by local checks. Rolling back ingestion keeps
saved slugs; rolling back the migration discards them and should be avoided once published.

## Homepage continuation and return navigation

The homepage server-renders ten ready stories from the existing ranking. Near the
bottom, it loads the next ten into the same list. Cards use uniform styling with
no position numbers or special first-place highlight; ranking still controls
the story order. A visible Load more button works
when automatic loading is unavailable, and ordinary Next page/Newer stories links
work without JavaScript. A direct `/?page=N` request uses the current selection;
page links carry a frozen cursor so successive pages retain their ranking and order.
The cursor is portable across instances and expires after eight hours. An expired or
invalidated continuation keeps already loaded cards visible and offers a fresh
selection. The selection is bounded to 400 stories; if it reaches that cap, the UI
points readers to the archive instead of claiming the site has no more stories.

Opening a homepage story saves the loaded cards, position, and focused story in the
browser history entry. Browser Back/Forward reconstructs those cards before
restoring position. The contextual return link carries the same snapshot through
history and, when available, tab-scoped session storage. Blocked session storage
does not prevent browsing or same-tab returns. Journey records are capped at 40
per tab with eight-hour expiry; cleanup touches only journey-owned keys. Same-tab
memory supplies a fallback if storage reads, writes or removal fail. Story URLs
stay canonical, and modified clicks use their normal browser behavior. The header
stays visible while scrolling, and the desktop left topic sidebar
sticks below its measured height. Tall navigation areas scroll within the viewport.
All main destinations remain available without reaching the footer. Automatic
loading stops while the continuation controls have keyboard focus, cancelling any
pending automatic request. A spinner shows while more stories load, and a retry
button appears only after a failed request. There is no separate Pause/Resume
control.

Story cards show time since first added in compact days and hours (e.g. `1d 2h`,
`5h`, or `<1h`), refreshed every minute. Before hydration, the UTC date is shown.
Each age is a native disclosure with a 44px target: click, tap, or focus it and
press Enter/Space to reveal the exact timestamp in local time. The disclosure
also works without JavaScript, using UTC.

The root homepage also saves a browser-local reading checkpoint under
`hacksnap:home-feed-checkpoint`. Reloading or reopening `/` within 30 minutes
restores the loaded selection and the visible story's offset in the viewport.
Older checkpoints with a valid selection offer **Continue where you left off**
and **Keep latest stories**. Scrolling, modified title clicks, category links and
HN comment links preserve the offer. Choosing latest, opening a fresh story with
an unmodified primary title activation, or loading more commits the new
reading session.
The **Start a fresh selection** link on an expired continuation explicitly requests
a fresh selection; its temporary query flag is removed after initialization.
Browser Back/Forward and explicit story returns take precedence over the durable
checkpoint.

Checkpoints store the loaded public story cards, pagination, a story ID and its
signed viewport offset, and a save timestamp. Position writes are debounced by
400ms and flushed when opening a feed story or when the page is hidden or left.
Storage is limited to one record, at most 400 stories and a conservative 2 MiB serialized UTF-16 size;
records older than seven days are ignored. This retention does not extend the
selection's eight-hour cursor lifetime. An expired saved selection shows fresh
stories with an explanation; a continuation invalidated by the server keeps its
loaded cards and offers a fresh selection. Missing anchors fall back to the saved
scroll coordinate. Initial layout/font changes can correct the anchor for up to
two seconds after the first positioning frame, or until the reader interacts.
Background tabs retain their target while animation frames are suspended; the
settling deadline cannot overwrite an unpositioned checkpoint.

Durable resume applies only to `/`; explicit paginated URLs keep their existing
history-based behavior. Progress is local to this browser, with no login or
cross-device synchronization. Unavailable storage, malformed records, and quota
failures leave ordinary browsing functional. Seen/opened history is a separate
planned feature and is not inferred from the reading checkpoint.

Analytics events `home_story_open` record actual activations of stories after the
first ten (`story_id`, 1-based `position`, `placement=home_feed`). Rendering or
fetching a card never emits that event. `home_feed_load` records each attempted
automatic or manual request with `trigger`, `outcome` (success, empty, failure,
expired, cancelled) and resulting `position`; `home_feed_end` records exhausted versus capped
selections once per route occurrence. These are client events and do not fire
without JavaScript. A cancelled request records its original trigger and the
number of loaded stories at request start exactly once, whether its aborted fetch
rejects or later resolves; it does not also record success or failure. Existing
`story_view` still records a rendered story page.

Run `npm test -- tests/home-feed-state.test.mjs tests/story-navigation.test.tsx
tests/navigation-context.test.mjs tests/analytics.test.mjs` for continuation,
return, and event contract coverage.

## Markdown content negotiation

The homepage, `/story/:id`, and `/docs/api` return Markdown when requested with
`Accept: text/markdown`. HTML remains the default, including wildcard requests.
Accept quality weights are respected; Markdown wins a tie when explicitly requested.
JSON APIs, RSS, metadata endpoints, and static assets retain their existing formats.

```sh
curl -i -H 'Accept: text/markdown' https://hacksnap.live/
curl -i -H 'Accept: text/markdown' https://hacksnap.live/story/12345678
```

Markdown responses include `Vary: Accept` and use
`Content-Type: text/markdown; charset=utf-8` and is generated directly from the
same public data as the pages, including source links and summary coverage.
Markdown responses use `Cache-Control: no-store` to preserve negotiation across
CDNs. Story data behind the handler has a bounded 30-minute cache shared by
HTML/metadata reads in the same instance; missing stories expire after 60 seconds.
The leaderboard uses a bounded 60-second per-instance data cache. Homepage, story HTML,
and `/docs/api` render per request. The proxy rewrites Markdown requests to the
Markdown handler before rendering.
Next.js replaces the HTML `Vary` header with its own router headers, so an
external CDN must bypass caching for these negotiated page URLs.
Missing stories return 404; data failures return a sanitized 503
with `Retry-After: 60`. HEAD returns the same headers without a body. No token
count is advertised because a tokenizer is not configured.

Run `npm test -- tests/markdown.test.mjs` for negotiation and content unit tests.
After deployment, validate with the
scanner from the [Markdown negotiation skill](https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md).

## Persistent story metrics

Story pages render a visible **Skept-o-meter & Hotness** section in the initial
HTML after the brief, discussion, and source notes, with the same metrics in
negotiated Markdown. It includes the existing
skepticism category, summary comment count, the separate skepticism sample count
when recorded, peak observed **Hacksnap** rank, estimated time in its Top 10,
and a ranking chart. Skepticism categories have no numeric score; meter positions
are visual conventions. Hacksnap ranks are distinct from HN front-page ranks.
Metric explanations sit behind keyboard- and touch-accessible info disclosures;
values and the chart stay visible. The disclosures work without JavaScript.
The chart reuses the homepage's `ActivitySparkline`, including trend colours,
curves, gradient fill and keyboard/touch exploration, in recorded-history mode.

Peak and duration use all retained `hacksnap_rank_history` observations, including
those older than 24 hours. The chart shows at most the latest 168 saved positions,
with its date range and truncation count visible. Current request-time ranks are
not added to these historical statistics. Time in the Top 10 holds each rank
until the next capture, excluding gaps over 13 hours (the scheduled overnight
gap plus timing tolerance) and time after the final capture. It is a sampled
estimate, not continuous tracking. Missing or insufficient history is shown
explicitly. No schema change or additional collection job is required.

Run `npm run test:history` for ranking calculations and metric formatting unit tests.

## Search metadata

`/sitemap.xml` lists the homepage, archive pages, and stories with summaries. Story `lastmod`
values use the latest stored publication, summary update, content snapshot, or ranking observation
timestamp. They remain stable between content writes; requests do not advance them.
The homepage omits `lastmod` because its ranking can change with time without a
database write. `changefreq` and `priority` are intentionally omitted.

Story SEO titles use `<headline> — Hacker News reactions | Hacksnap`, keeping the
original article title as the H1. Only the headline is shortened (to 60 characters),
so the reaction label and brand are retained. Open Graph and Twitter titles also
include the reaction label. Descriptions use the actual sampled-comment count and
up to three existing discussion-point titles, with 155-character search and
125-character social targets. Discussion-only summaries do not claim article
coverage, and zero-comment samples are identified explicitly. Each story also
supplies its canonical URL and Twitter large-image card. Pending summaries use a descriptive
fallback and `noindex, follow`, and are excluded from the sitemap. Once a summary is
available, the story enters the sitemap and becomes indexable on the page's next
revalidation (the existing cache interval is 30 minutes). The metadata and page
share a request-scoped read backed by the bounded per-instance story cache.

Social previews use a ready stored Vercel Blob asset when one passes the public
image contract. Pending, failed, missing, or malformed assets use the shared
1200×630 brand card at `/opengraph-image`, rendered by `lib/og-image.tsx`.
The story metadata declares that choice directly because a story-level
`opengraph-image` file would take priority over it. The legacy story preview
URL remains an ordinary route handler, so old links redirect to a ready asset or
return the brand card without changing metadata. The brand card uses the bundled
font and needs no external image/font service or model call.

`/feed.xml` returns RSS 2.0 for the latest 50 stored stories ordered by publication
on Hacksnap (`date_added`, then ID). Entries contain titles, canonical links,
stable GUIDs, publication dates, and the takeaway, article brief, and discussion
summary when available. Descriptions are HTML-escaped plain text before XML
serialization, so feed readers preserve literal markup without creating elements
or loading embedded resources. XML values are escaped and invalid XML characters removed.
The feed uses a five-minute per-instance data cache and declares
`Cache-Control: public, max-age=0, s-maxage=300`. Data and HTTP caching can add up
to ten minutes of delay for additions, summary edits, and removals. Failures return
a sanitized 503 with `no-store` and `Retry-After: 60`. HTML alternate links and the footer advertise the feed.

Run `npm test -- tests/rss.test.mjs` and `npm run build` from this directory.

## Page caching and Cloudflare

### Mobile loading performance

`experimental.inlineCss` embeds the small shared stylesheet in production HTML,
removing a blocking stylesheet round trip. This increases HTML size and gives up
independent stylesheet caching on full page loads; reassess if the CSS grows.
Google Analytics uses `lazyOnload` to fetch after the load event during browser
idle time. Its configuration is queued after hydration. This delays analytics
work rather than reducing the Google script's size, and very short visits may
leave before analytics loads.

In Cloudflare, disable **Email Address Obfuscation** for `hacksnap.live` (use a
hostname-scoped configuration rule if the zone serves other sites). Cloudflare
injects `email-decode.min.js`; changing app scripts or static-asset cache headers
cannot remove that injected request. Purge cached HTML after changing the setting
and verify that the public HTML no longer references `/cdn-cgi/` email decoding.
This also removes the associated short-cache-lifetime warning. This setting is
managed outside this repository.

The legacy-JavaScript signatures in the report match Next.js's built-in runtime
polyfills. Do not alias those internal modules to empty files: doing so bypasses
the framework's browser compatibility behavior. A Browserslist change alone does
not remove this already-built framework code.

After deployment, rerun PageSpeed Insights in mobile mode for the homepage and a
story. Check FCP, LCP, and total blocking time across several runs, verify there is
no initial external stylesheet request or email-decoding script, and confirm GA
still records visits and client-side navigation. Deferring GA does not guarantee
that Lighthouse's unused-JavaScript warning disappears.

References: [Next.js inline CSS](https://nextjs.org/docs/app/api-reference/config/next-config-js/inlineCss),
[script loading](https://nextjs.org/docs/app/api-reference/components/script), and
[Cloudflare email obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/).

### Production deployments and Cloudflare

Production deployments no longer trigger a Cloudflare cache purge. HTML bypasses
Cloudflare caching, so clearing the entire zone on each deployment is unnecessary.
Keep the page bypass rules below in place. Vercel manages the application's ISR
cache separately.

Static assets can remain cached. If a cached asset changes without its URL
changing, purge that URL manually or version its filename.

The retired purge workflow's `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`
repository secrets are no longer used by this repository's workflows. They can be
removed if nothing else relies on them. Workers deployments and Spamhaus updates
use their own dedicated tokens.

### Page cache configuration

The homepage and `/story/:id` render per request so outages cannot become cached
HTML. The homepage accepts only `/`; unmatched paths return 404 before data access.
Builds need no database connection. Runtime requests use `HACKSNAP_WEB_DATABASE_URL`
with the dedicated `hacksnap_reader` login. Leaderboard data uses a bounded
60-second per-instance cache with one entry and one pending load. The shared selection
contains the first ten cards, bounded continuation IDs/ranks/recency flags, ingestion
time, and observation time from one SQL statement. `getLeaderboard()` (Markdown and
`/api/stories`) and the first HTML/ready-stories page read that same cached snapshot;
request order cannot populate independent first-page rankings or timestamps.
Concurrent callers share a load; after expiry they wait for fresh data, and failures use the existing
unavailable response rather than returning stale rankings. Separate instances can
differ within that one-minute window. This applies to homepage HTML, Markdown and
the list API; it also refreshes ranking changes caused by the 24-hour recency cutoff.
Story data uses the bounded per-instance cache documented below. Story HTML waits
for the required story and canonical URL check, then streams the article while
the optional "Read next" query resolves. Category HTML waits for its required
story list and page check, then streams the optional count. This ordering matters
because each instance has one pooled database connection: optional reads begin
only after required reads finish. A failed optional read keeps the article or list
and renders its local fallback. The first HTML stream remains useful without
JavaScript; recommendation cards still use the existing exposure tracking when
they arrive and become visible. The reserved recommendation space reduces layout
movement during a delayed read, though very long titles or an empty/error result
can still change its height.

`/api/ready-stories` is an additive ranked-feed endpoint for continuous browsing.
It returns up to ten summary-ready cards and a continuation cursor. An initial
`pageSize` may be 1–10 (default 10). The cursor retains that size: follow either
`cursor` or `previousCursor` without resending `pageSize`. If supplied on a
continuation, `pageSize` must match the original size or the endpoint returns 400
(`invalid_page_size`). Page numbers and backward cursors use the retained size,
including a shorter final batch. Version 1 cursors, which did not encode a size,
are rejected; start a fresh selection to obtain a version 2 cursor.
The first request captures ordered story IDs, canonical ranks and recency flags; the cursor preserves
that membership and ordering for eight hours while card metadata may refresh through
a bounded 60-second cache. Cursors are portable, validated encodings of an already
public selection, not authentication or tamper-proof credentials. Invalid cursors
return 400; an expired cursor or a selected story that becomes unavailable returns
410 so clients restart instead of combining selections. The selection is capped at
400 stories to keep URLs bounded. `selectionLimited: true` distinguishes that cap
from the actual end of the pool. Continuation responses are `no-store`; only 64
recent page reads and 8 concurrent misses are admitted per instance.

In Cloudflare, create a **Bypass cache** rule for:

```text
(http.host eq "hacksnap.live" and
 (http.request.uri.path eq "/" or
  starts_with(http.request.uri.path, "/story/") or
  http.request.uri.path eq "/docs/api"))
```

Ensure no later cache rule overrides this bypass. Keep static asset caching
unchanged. Cloudflare page requests reach Vercel for dynamic HTML rendering.
Cloudflare may report `DYNAMIC` or `BYPASS`. Preserve request headers and
query strings, including Next.js `_rsc` navigation parameters.

After deploying, request HTML, then Markdown, then HTML for both `/` and a valid
story URL. Verify the content types remain distinct across repeated requests,
and check client-side story navigation. Do not force a shared Cloudflare HTML
cache merely to improve its cache-hit metric.

Unit tests verify cache expiry, format headers, and route validation using mocks.

## Archive

`/archive` lists all retained public stories, including the current Top 10, newest
first. `/archive/YYYY/MM` filters by the UTC month in which a story was added to
Hacksnap. Daily headings use that same date, not the summary update time.
Top Stories, Latest, dated archives, and topic listings reuse `app/story-feed.tsx`
for automatic loading near the end of the feed, failed-load retries, accessible
status announcements, and story-return restoration. Server routes own filtering
and ordering; Latest/archives retain UTC day headings and topics use an unranked
list. Each archive/topic request loads up to 30 stories through
`/api/browse-stories?path=...&page=...`, using the same bounded data readers as HTML.
Pending briefs remain visible. Ordinary page links and canonical URLs still work
without JavaScript. Loaded rows are deduplicated and saved with the exact listing
URL in browser history for back/forward and explicit story returns. Archive/topic
pagination retains its existing live offset ordering, so new arrivals can shift
page boundaries during browsing; it does not freeze a ranked selection.
Duplicate-only archive/topic batches still advance the page, so subsequent loads
can reach older stories. Frozen ranked batches retain the no-progress guard.
Archive and category listings accept pages 1–100 (at most 3,000 stories and an SQL
offset of 2,970). Larger pages return 404 before data access;
the final allowed page has no older-page link. Use dated archive URLs to reach
older archive entries. Categories show their latest 3,000 stories; deeper category
browsing needs cursor pagination before this limit can be raised. The feed starts
directly below the heading, without the All stories or Browse by month controls.
Archive pages are rendered on request; no schema change is required. The sitemap
includes the archive landing page and populated months. Story URLs stay unchanged.

Run `npm run test:archive` for route validation, month boundaries and pagination parsing unit tests.

## Category flairs

Story pages show up to three **More in [category]** next reads after the discussion,
before the ranking metrics. They exclude
the current story, pending briefs, future-dated stories and invalid public IDs,
and sort by date added descending, then story ID descending. Each shows its
headline, takeaway and date added, followed by a link to browse the category.
Stories with no qualifying next reads or no category link to the latest archive
instead. The section is server-rendered and shares the story page's existing
30-minute revalidation. It uses the existing category/date index and requires no
migration. `npm run test:categories` covers category routing and navigation context.

Stories display a compact category flair directly below their title on the
homepage, article pages and archive. Clicking a flair opens
`/category/<slug>`, with the topic description and all stored stories in that
category, newest first. The homepage has no category directory or menu.

The six category pages use stable slugs from `lib/categories.ts`, paginate at 30
stories, include pending summaries, and return 404 for unknown slugs or invalid
pages. They render on request and each pagination URL has its own canonical URL.
The sitemap includes all six topic landing pages. API responses expose the
nullable category identifier; homepage and article Markdown include category links.

Deploy database migration `0011_categories` before this website version. Only the
public category field is granted to the website role; model, version, timestamp
and input hash remain private. Keep category IDs in the frontend and ingestion
classifier aligned; the ingestion tests check that contract.

Run `npm run test:categories` for category routing and navigation context unit tests.

## Frontend checks

Use Node.js 22.22.2 or newer in the Node 22 line and `npm ci`, then run:

```sh
npm run lint
npm run format:check
npm run test:ci
npm run typecheck
npm run build
```

CI runs Oxlint, Oxfmt, and Jest on pull requests and pushes to `main`.
Run `npm run format` to apply formatting locally. Jest discovers all
`tests/**/*.test.mjs` and `tests/**/*.test.tsx` files. Tests cover pure functions,
handlers with injected data access, and React components in jsdom. Database and
live HTTP integration suites have been removed; tests need no server, database,
or credentials. The test process uses America/Los_Angeles to verify hydration
across a UTC date boundary. Jest uses ESM and SWC for TypeScript/TSX. For jsdom 30 on Node 22, the Jest
configuration also uses SWC to compile the allowlisted ESM dependencies in
jsdom's encoding, CSS, and HTML parser dependency chain to CommonJS. Application
code and test modules continue to run as ESM.

## Canonical article images

Migration `0015_article_images` adds nullable image fields to
`hacker_news_threads`. The web reader checks that all five fields and their
column grants are available on each uncached story read. Before the migration,
or while its reader grant is unavailable, pages and public API responses use
null image fields and keep their ordinary text layout.

The interface only renders records with `image_status = 'ready'` and an HTTPS
URL on a `*.public.blob.vercel-storage.com` host. It never reads or exposes the
publisher source-image URL. Missing, pending, failed, and malformed records omit
the image wrapper. Browser load errors keep a branded placeholder in the reserved
frame while preserving the card or story content. Until source descriptions are stored, the supplementary images use an
empty alt attribute so the headline remains the accessible label. Detail images
retain their supplied intrinsic dimensions. Feed images also keep their original
aspect ratio: their width follows the image column and their height is automatic,
so the complete image is visible without cropping or letterboxing. Error
placeholders preserve the stored aspect ratio. This applies to Top, archive and
category feeds. Social Open Graph images retain the existing generated template.

## Discussion-analysis projections

Deploy additive migration `0012_discussion_analysis` to enable discussion analysis.
The website checks the three public columns and their SELECT privileges in each
story-read transaction. Until they are available, it serves existing summaries
with null analysis fields and logs a migration warning. The next uncached read
automatically enables analysis after the migration; leaderboard data may remain
cached for up to 30 minutes.

The Supabase schema workflow validates migrations on push but applies them only
on `workflow_dispatch`. Run that workflow on `main` and verify that its **Apply
schema migrations** job succeeds before deploying schema-dependent features.
Database read failures log only SQLSTATE, never query text or database messages.
`getStory` exposes `summary.discussion_analysis` with reference claims, selected
critical/supportive highlights and topic citations. Leaderboard, RSS source,
archive and category reads expose `summary.discussion_analysis_preview`: status,
topic key/title/summary and selected evidence counts. These counts describe the
selected highlights, not the proportion of commenters who agree or disagree.
Both projections include `discussion_analyzed_at` and the reader-safe
`discussion_analysis_coverage` column. Worker metadata and raw comments remain
private. API and Markdown exports preserve their existing consumer fields.

The new summary fields are optional in public TypeScript types for older fixtures
and cached payloads. Missing or null analysis means unavailable; it does not
promise backfill. An analysis with `status: "no_comments"` is an explicit analyzed
result. The leaderboard cache version changes to discard older cached projections.

`tests/discussion-projection.test.mjs` runs the shared contract fixtures, legacy
and pending rows through embedded PostgreSQL with the migration's reader grant.
It verifies detail completeness, compact feeds and denied private-column reads
without credentials or a database server. PGlite is a test-only dependency.

## Data outages

Database connection and query failures become sanitized availability errors.
Frontend pages show a retry action inside the normal navigation; these responses
opt out of caching. Home and story pages render per request so a transient
outage cannot become a cached page; the leaderboard uses its 60-second cache with hard expiry. Empty lists remain valid empty states, and unknown stories
remain 404s. Story metadata handles outages without failing rendering or claiming
that a temporarily unavailable story does not exist. Related stories and topic
counts are optional, so their failure does not hide otherwise available content.

JSON APIs, Markdown, RSS, and story image endpoints return a sanitized 503 with
`Retry-After: 60` and `Cache-Control: no-store` when their data is unavailable.
The sitemap retains static navigation entries during outages. Unexpected errors
outside data reads still reach the normal error boundary.

## Story discussion analysis

New-format story pages expose `#discussion-analysis` for feed links. They use the
public analysis contract to show expandable, cited themes and two groups of
paraphrased comments with explicit stance, caveats and original target claims.
Each theme places its info icon beside the title and reserves the far-right chevron
for expansion. The info icon opens a small source-comment popup, independently
of the theme description. Critical and supportive highlights show the addressed
claim in italics above their stance label and commentary. Each highlight has the
same info popup for its original comment link. A close icon, Escape, or clicking
outside dismisses the popup.
Native popovers work without JavaScript; CSS anchor positioning places them beside
the info icon, with a centered fallback in browsers without anchor support.
Groups stack when space is limited; native disclosures and ordinary source links
work with keyboard navigation and without JavaScript. Coverage and UTC analysis
time come from discussion fields, independently of the article summary.

New themes replace legacy discussion points, keeping the discussion summary as
the introduction. New summaries contain a short opening followed by plain-text
`- ` bullet lines. HTML renders semantic lists and Markdown retains list markers,
while escaping each item's content. Legacy prose remains separate paragraphs.
The stored summary string, RSS and public API contract remain unchanged. Null or
absent analysis preserves legacy rendering without promising a backfill. No-comments
and insufficient-context states explain their limits; empty groups only describe missing evidence within the analyzed sample.
Legacy skepticism is never treated as explicit support.

Run `npm test -- tests/discussion-analysis.test.tsx tests/story-content.test.tsx`.
These tests use the shared `../fixtures/discussion-analysis/valid.json` contract
fixtures and need no live analysis or database.

## Discussion exports

Story Markdown includes themes, source-comment links, paraphrased stance highlights,
claim context, sample limitations, and independent analysis coverage/time. Missing
analysis keeps legacy discussion points; explicit no-comments and insufficient-context
results describe their limits. Nothing triggers a backfill or export regeneration.

`GET /api/stories/{id}` adds optional, nullable `summary.discussion_analysis`.
The object explicitly exports status, claims, highlights, cited themes, `analyzed_at`,
and `coverage`. Nested fields are allowlisted, excluding worker metadata and raw
source payloads. The list endpoint retains its compact summary; request a detail
for evidence. OpenAPI 1.1.0, HTML docs, and negotiated Markdown docs describe the
same additive contract. Clients should handle absent fields from older responses.

Run `npm test -- tests/api.test.mjs tests/markdown.test.mjs` for shared analysis
fixtures, schema validation, legacy/unavailable states, escaping, and private-field
exclusion. Ajv validates API responses against the published OpenAPI schemas.

## Feed card layout

At phone widths (640px and below), cards stack the category and rank, title,
full-width image, then subtitle/excerpt and footer. The image uses its original
proportions, including while loading or showing its error fallback. Cards without
an image go directly from title to excerpt without an empty image row.

Above 640px, the category and rank occupy a full-width row above the image and
content. The image column uses 30% of the available width, capped at 18rem, giving
landscape previews more room. Image height follows its original proportions;
text can make a row taller when needed. The footer aligns to the bottom of the
content column. Narrow desktop cards keep the image beside the title and give
the excerpt and footer the full width. Footer controls wrap when text is enlarged.
Feed headlines use rem units so they scale with the excerpt and metadata when
readers enlarge text. Light and dark themes share the same sizing and layout.

Home, archive and category cards omit discussion themes and the “Read the debate”
link. The title opens the full story, where discussion analysis remains available.
The compact discussion projection and public exports are unchanged.

## Public read limits

`/api/stories/{id}` uses a parameterized primary-key lookup of just the existing
public fields, three summary strings, and the public discussion analysis now in
the detail contract. It does not read ranking views, rank history, or worker metadata. Invalid IDs return an uncacheable
400 before acquiring a database connection. Unknown valid IDs return a cacheable 404. Database failures and cache-capacity failures return a sanitized, uncacheable
503 with `Retry-After: 60`.

| Data cache                 | Positive TTL  | Missing TTL | Maximum entries | Maximum pending distinct keys |
| -------------------------- | ------------- | ----------- | --------------- | ----------------------------- |
| Public API detail          | 300 seconds   | 60 seconds  | 512             | 8                             |
| Story rendering / Markdown | 1,800 seconds | 60 seconds  | 128             | 4                             |
| RSS data                   | 300 seconds   | n/a         | 1               | 1                             |

These caches live in each running instance, expire without serving stale results,
share concurrent loads for the same key, and evict the least recently used completed
entry at capacity. Pending loads count toward capacity. Failures are never stored;
excess distinct pending keys fail before entering the database queue. The existing
single-connection pool, read-only transactions, and statement timeout still apply.
Schema/grant checks run on cache misses; cached legacy projections pick up a
new migration after expiry. Cold starts and separate instances each have their own caches. These are work and
memory bounds, not a distributed request-rate limit or a byte limit on stored text.

API detail successes declare `public, max-age=0, s-maxage=300`; safe 404s declare
`public, max-age=0, s-maxage=60`. Combining data and HTTP caches can delay a detail
update by up to ten minutes, or discovery of a previously missing ID by two minutes.
Story HTML renders per request using story data cached for at most 30 minutes. Markdown stays
uncacheable at HTTP level and preserves `Vary: Accept` and HEAD behavior.

Archive/category bounds limit offsets, but their count queries and story metric
cache misses still depend on retained data. Requests across many IDs or instances
still require edge rate limiting and verified origin restrictions. See the
[issue #75 verification report](../../docs/security/issue-75-public-read-limits.md)
for deployment evidence and remaining exposure.

## Discussion rendering fallback

Set server-only `HACKSNAP_DISCUSSION_RENDERING=false` and redeploy to use legacy
summary projections across story, public API, feed, archive and category reads. Stored analysis
and worker generation are unchanged. Enabled and disabled deployments use separate
leaderboard cache keys. Remove the setting and redeploy to restore analysis.
See the [rollout runbook](../../docs/evaluations/issue-42/README.md).
