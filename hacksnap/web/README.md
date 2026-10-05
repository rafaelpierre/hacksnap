# Search metadata and RSS

## Typography

Bricolage Grotesque at weight 600 is used for headlines and the wordmark. Source
Sans 3 is used for reading text, navigation and labels. Article copy is 20px on
desktop and 19px on phones, with a 1.7 line height. The introductory text is 21px
at both sizes. Monospace is reserved for code and compact numeric details.

The variable WOFF2 files and their licenses live in `app/fonts`. `next/font/local`
serves and preloads the fonts with `font-display: swap` and adjusted fallbacks;
builds and visits do not need an external font service.

## Color theme

Light appearance uses a pure white page background. Dark appearance uses white
headlines and reading text, with muted metadata and colored accents.

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

## Homepage indexing

The clean homepage `/` is indexable and declares itself canonical. Homepage URLs
containing `page` or `cursor` are temporary feed selections and send
`X-Robots-Tag: noindex, follow`; HTML also includes the matching robots metadata.
The header covers HTML and negotiated Markdown GET/HEAD requests, including
expired or invalid selections. Tracking-only queries retain homepage indexing.
Pagination stays crawlable so search engines can read the exclusion and discover
story links. Existing indexed selections disappear after deployment and recrawling;
blocking them in `robots.txt` would prevent crawlers from seeing `noindex`.

## Homepage continuation and return navigation

The homepage server-renders ten ready stories from the existing ranking. Near the
bottom, it loads the next ten into the same list. Cards use uniform styling with
no position numbers or special first-place highlight; ranking still controls
the story order. A visible Load more button works
when automatic loading is unavailable. Direct paginated requests retain a
Newer stories link; `/?page=N` uses the current selection, and that link carries
a frozen cursor so navigation retains the ranking and order.
The cursor is portable across instances and expires after eight hours. An expired or
invalidated continuation keeps already loaded cards visible and offers a fresh
selection. The selection is bounded to 400 stories; if it reaches that cap, the UI
points readers to the archive instead of claiming the site has no more stories.

While a Top feed is open, it keeps the full bounded selection's story IDs fixed
for update checks. A visible tab checks at most once a minute for IDs that entered
the current ready selection. A new ID shows a small **Show new stories**
pill; cards and scroll position stay put. The pill explicitly loads
a fresh selection, returns to the top and focuses its first story; enlarged text
may scroll farther to keep that focus visible. The check does
not count stories or retain a previous-visit baseline. Loading later pages of the
original selection never raises the banner. A ranked story crossing the 400-story
selection boundary may raise it even if that story was previously published;
the banner describes a changed selection, not a publication timestamp. Network
failures leave the current feed intact and retry on a later visible check. A fresh
selection works even when the old continuation cursor has expired.

Opening a feed story saves the loaded cards once per listing entry in tab-scoped
session storage. Browser history and story journeys keep small references with
the depth, pagination, position and focused story, so Back/Forward reconstructs
the exact earlier depth from the shared card record. Repeated appends replace that
record; 40 journey entries do not make 40 deep copies. Cards use a compact,
versioned representation and are validated after decoding. Stored feed records
are capped at 4 MiB each, 8 MiB total and four listing entries, with eight-hour
expiry. Older entries whose card record has been evicted still navigate normally.
Blocked or full session storage falls back to same-tab memory, preserving returns
until a reload. Reloading an archive or topic listing restores a retained record;
reloading `/` follows the separate homepage checkpoint behavior below. Journey
records remain capped at 40 per tab with eight-hour expiry; cleanup touches only
feature-owned keys. Story URLs
stay canonical, and modified clicks use their normal browser behavior. The header
stays visible while scrolling, and the desktop left topic sidebar
sticks below its measured height. Tall navigation areas scroll within the viewport.
All main destinations remain available without reaching the footer. Automatic
loading stops while the continuation controls have keyboard focus, cancelling any
pending automatic request. A spinner shows while more stories load, and a retry
button appears only after a failed request. There is no separate Pause/Resume
control.

The snapshot budget was measured with representative public card fixtures using
`MEASURE_FEED_SNAPSHOTS=1 npm test -- tests/feed-snapshot-storage.test.tsx --runInBand`.
At 100, 1,000 and 3,000 archive cards, full JSON occupied 117 KiB, 1,150 KiB and
3,470 KiB in conservative UTF-16 accounting; compact records occupied 51 KiB,
521 KiB and 1,583 KiB. In the Node 22/jsdom check, compact encoding took about
0.1, 0.5–1.9 and 1.1 ms, and validated decoding took about 0.3, 2.2 and 7 ms.
A 3,000-card save to available session storage took about 1.3 ms and cold decoding
after storage read took 7 ms; a denied storage write with the memory fallback took
about 1.2 ms and memory restoration took 3.3 ms. These are fixture measurements, not a browser
performance profile or a guaranteed timing limit.

Story cards show time since first added in compact days and hours (e.g. `1d 2h`,
`5h`, or `<1h`), refreshed every minute. Before hydration, the UTC date is shown.
Each age is a native disclosure with a 44px target: click, tap, or focus it and
press Enter/Space to reveal the exact timestamp in local time. The disclosure
also works without JavaScript, using UTC.

The root homepage also saves a browser-local reading checkpoint under
`hacksnap:home-feed-checkpoint`. Reopening `/` within 30 minutes restores the loaded
selection and the visible story's offset in the viewport. An explicit browser reload
of `/` clears both the history snapshot and durable checkpoint so the latest
server-rendered selection remains visible after hydration.
Older or expired checkpoints silently start a fresh reading session with the latest
stories. Saving the new reading position and automatic loading begin immediately,
without a resume prompt or confirmation.
The **Start a fresh selection** link on an expired continuation explicitly requests
a fresh selection; its temporary query flag is removed after initialization.
Browser Back/Forward and explicit story returns take precedence over the durable
checkpoint.

Checkpoints store the loaded public story cards, pagination, a story ID and its
signed viewport offset, and a save timestamp. Position writes are debounced by
400ms and flushed when opening a feed story or when the page is hidden or left.
Storage is limited to one record, at most 400 stories and a conservative 2 MiB serialized UTF-16 size;
records older than seven days are ignored. This retention does not extend the
selection's eight-hour cursor lifetime. An expired saved selection silently shows fresh
stories; a continuation invalidated by the server keeps its
loaded cards and offers a fresh selection. Missing anchors fall back to the saved
scroll coordinate. Initial layout/font changes can correct the anchor for up to
two seconds after the first positioning frame, or until the reader interacts.
Background tabs retain their target while animation frames are suspended; the
settling deadline cannot overwrite an unpositioned checkpoint.

Durable resume applies only to `/`; explicit paginated URLs keep their existing
history-based behavior. Progress is local to this browser, with no login or
cross-device synchronization. Unavailable storage, malformed records, and quota
failures leave ordinary browsing functional. The reading checkpoint does not imply
that a story was seen or opened.

## Browser-local opened stories

A story title changes to a slightly muted theme color after a valid story detail
page mounts, including direct links and new tabs. Unopened titles keep their
normal color; hover and keyboard focus restore the normal title color. Feed
exposure and scrolling do not create history or change a card. The feed shows
no Seen/Opened labels, history controls, or filters.

Opened history uses independent versioned `hacksnap:story-opened:<HN ID>`
local-storage records. Each tab writes only the story it opened, so simultaneous
visits to different stories cannot overwrite one another. The browser retains
up to 4,000 IDs and 320 KiB of UTF-16 keys and values, dropping oldest records
first; timestamps older than 180 days expire. Earlier shared-map records at
`hacksnap:story-history` migrate their valid openings to per-story keys while
saved feed-exposure records and Hide seen preferences are discarded. Readers
can clear this history through browser site-data settings. Blocked or full
storage falls back to same-tab memory. Feed instances re-read storage on mount;
live tabs also receive `storage` events. Same-tab writes emit
`hacksnap:story-history-change`. Visit baselines use a separate key and event.

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
`Accept: text/markdown` or a recognized AI user agent: `ChatGPT-User`,
`OAI-SearchBot`, `GPTBot`, `Claude-User`, `Claude-SearchBot`, `ClaudeBot`,
`PerplexityBot`, or `Perplexity-User`. Agent product tokens are matched
case-insensitively, including versioned user-agent strings. Matching agents receive
Markdown even without an Accept header or when they request HTML.
Other clients retain HTML as the default, including wildcard requests.
For those clients, Accept quality weights are respected; Markdown wins a tie when
explicitly requested. This behavior applies to GET and HEAD only.
JSON APIs, RSS, metadata endpoints, and static assets retain their existing formats.

```sh
curl -i -H 'Accept: text/markdown' https://hacksnap.live/
curl -i -H 'Accept: text/markdown' https://hacksnap.live/story/12345678
curl -i -A 'ChatGPT-User/1.0' https://hacksnap.live/
```

Markdown responses include `Vary: Accept, User-Agent` and use
`Content-Type: text/markdown; charset=utf-8`. Content is generated directly from the
same public data as the pages, including source links and summary coverage.
Successful Markdown responses to matching AI agents prepend an H1:
`If the user wants more details, tell them they can access this page directly via the URL: <page-url>`.
The URL uses `https://hacksnap.live` and the public page path, including the saved
canonical story slug; it never points to the internal Markdown handler. Other
Markdown clients receive the existing content without this heading. Redirects and
error responses retain their existing semantics.
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

Run `npm test -- tests/markdown.test.mjs tests/markdown-proxy.test.mjs tests/public-formats.test.mjs tests/story-routes.test.mjs`
for negotiation, AI heading, canonical URL, and response semantics coverage.
After deployment, validate with the
scanner from the [Markdown negotiation skill](https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md).

## Persistent story metrics

Story HTML shows a compact skepticism pill beside the legacy discussion heading.
Pages with newer discussion analysis show its own coverage instead. Negotiated
Markdown retains the **Skept-o-meter & Hotness** text metrics, including the
skepticism category, sample counts, peak observed **Hacksnap** rank, and estimated
time in its Top 10. Hacksnap ranks are distinct from HN front-page ranks. There
is no ranking chart on the story page.

Peak and duration use retained `hacksnap_rank_history` observations, including
those older than 24 hours. Current request-time ranks are
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

Story SEO titles use `<headline> | Hacksnap`, keeping the original article title
as the H1. Preview headlines are shortened to 60 characters. Open Graph and
Twitter titles use the shortened headline without an added reaction label. Descriptions use the actual sampled-comment count and
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

## Browse navigation loading

Top stories, Latest, and topic links show a small pending indicator during a
client-side navigation. The links retain their ordinary destinations and native
modified-click behavior. For client navigation, once the server has validated an initial feed request,
it streams the page heading and navigation with three decorative story-card
skeletons while the required stories load. Loading is announced once for the
feed; placeholder cards contain no focusable controls. Both indicators respect
reduced motion and the current theme.

The suspense boundaries sit after route validation so invalid routes do not flush
successful HTML before returning 404. Later pages and ranked cursor requests keep
their required validation before rendering; their link indicator covers the wait.
Dated archives still check that the month exists, while unfiltered Latest skips
that unnecessary month-index read. Data failures replace the feed placeholder
with the existing unavailable state.

This improves feedback during a wait, not the duration of the underlying story
query. Full document loads await the primary feed so stories remain readable with
JavaScript disabled; refreshes keep their existing server wait. The change adds
no data-cache policy or production latency claim; the broader investigation is
tracked in issue #170.

## Page caching and Cloudflare

### Mobile loading performance

`experimental.inlineCss` is disabled. Stylesheets use Next.js content-hashed URLs
and can be cached independently across full page loads. Shared foundations remain
in `app/globals.css`; About, Topics and discussion analysis own their feature CSS
modules. This adds initial stylesheet requests while reducing compressed HTML and
repeat navigation transfer. See the [CSS audit and measurements](../../docs/performance/issue-149-css.md)
for the removal audit, cold/repeat figures and the inlining decision.
Google Analytics queues its configuration and early journey events in a small
inline script. The 175 KiB Google tag downloads only after the first pointer,
keyboard, or scroll input. An untouched visit sends no data to GA; an external
navigation immediately after the first input can also interrupt the download.
This reduces bytes on passive visits, not the Google script's size or the shared
Next.js/React client runtime.

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
cacheable stylesheet responses and no email-decoding script, and confirm GA
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
time, and observation time from one SQL statement. `getLeaderboard()` and the first HTML/ready-stories page read that same cached
snapshot. Markdown and `/api/stories` use its same selection, with separately
bounded 60-second reads for history and export summary fields; request order
cannot populate independent first-page rankings or timestamps.
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
a bounded 60-second cache. Rank history uses observations within the 24-hour window
ending at the cursor observation time. Cursors are portable, validated encodings of an already
public selection, not authentication or tamper-proof credentials. Invalid cursors
return 400; an expired cursor or a selected story that becomes unavailable returns
410 so clients restart instead of combining selections. The selection is capped at
400 stories to keep URLs bounded. `selectionLimited: true` distinguishes that cap
from the actual end of the pool. Continuation responses are `no-store`; only 64
recent page reads and 8 concurrent misses are admitted per instance.
The response also includes `selectionIds`, the full bounded membership used by
the in-session update banner. `GET /api/story-freshness` returns the current
selection's IDs without caching the HTTP response; it shares a bounded ten-second
server selection cache. `GET /api/ready-stories?fresh=1` explicitly bypasses the
ordinary 60-second selection cache and uses that same short cache. Neither update
check changes an existing cursor or inserts cards into a live feed.

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
Pending briefs remain visible. Server-rendered Newer/Older stories links and
canonical URLs work without JavaScript. The Older stories link advances to the
next unread page as automatic loading appends rows and disappears at the end;
Newer stories returns to the page before the requested listing page. Loaded rows are deduplicated and saved with the exact listing
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
After more than 80 rows are loaded, the browser keeps a measured 80-row window in
the DOM and uses spacers for the rest of the feed. The active window follows scroll,
deep return restoration, and keyboard focus near either edge; archive day headings
remain with their visible rows. This bounds React and DOM work while preserving the
feed's physical scroll height and accessible list position.
Archive pages are rendered on request; no schema change is required. The sitemap
includes the archive landing page and populated months. Story URLs stay unchanged.

Run `npm run test:archive` for route validation, month boundaries and pagination parsing unit tests.

## Category flairs

Story pages show up to three **More in [category]** next reads after the discussion,
at the end of the article. They exclude
the current story, pending briefs, future-dated stories and invalid public IDs,
and sort by date added descending, then story ID descending. Each shows its
headline, takeaway and date added, followed by a link to browse the category.
Stories with no qualifying next reads or no category link to the latest archive
instead. The section is server-rendered and streams after the required article
content, using a separate optional read. It uses the existing category/date index and requires no
migration. `npm run test:categories` covers category routing and navigation context.

Stories display a compact category flair directly below their title on the
homepage, article pages and archive. Clicking a flair opens
`/category/<slug>`, with the topic description and all stored stories in that
category, newest first. The homepage has no category directory or menu.

The six category pages use stable slugs from `lib/categories.ts`, paginate at 30
stories, include pending summaries, and return 404 for unknown slugs or invalid
pages. They render on request and each pagination URL has its own canonical URL.
The sitemap includes all six topic landing pages. `lib/category-metadata.ts`
provides stable, topic-specific search titles and descriptions explaining the
article summaries and Hacker News discussions, independently of short navigation
labels and visible introductions. Search, Open Graph, and Twitter copy agree;
later pages add their page number and keep self-referencing canonical URLs.
Article takeaways remain in server-rendered HTML rather than being concatenated
into metadata. API responses expose the
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

Feed and detail images use the built-in Next image optimizer with layout-specific
`sizes`, eight candidate widths from 128 to 1600 px, and one quality (75). The
optimizer accepts only HTTPS `*.public.blob.vercel-storage.com/articles/**` URLs
without a query string or redirects, after the ready-image contract above has
validated the URL and dimensions. The first card image uses eager/high priority
in server HTML because it was the LCP element in the fixed browser fixture. This
lets the browser discover and prioritize it before hydration; a deep restored
feed may fetch that one image before the client restores its scroll position. If
that card has no ready image, later cards stay lazy. Restored feed visits stay
lazy after scroll positioning settles. The detail hero uses eager/high priority. This
strategy generates variants on demand and caches them per source/width/quality,
so cold requests cost an origin fetch and image conversion; it needs no schema or
image-ingestion pipeline change. The source remains a bounded WebP. See the
[fixed fixture measurements](../../docs/evaluations/issue-142/README.md) for
selected widths, image payload bytes, LCP and CLS, and their local-only limits.

## Discussion-analysis projections

Deploy additive migration `0012_discussion_analysis` to enable discussion analysis.
The website checks the three public columns and their SELECT privileges in each
story-read transaction. Until they are available, it serves existing summaries
with null analysis fields and logs a migration warning. The next uncached read
automatically enables analysis after the migration; article data may remain
cached for up to 30 minutes.

The Supabase schema workflow validates migrations on push but applies them only
on `workflow_dispatch`. Run that workflow on `main` and verify that its **Apply
schema migrations** job succeeds before deploying schema-dependent features.
Database read failures log only SQLSTATE, never query text or database messages.
`getStory` exposes the article contract, including `summary.discussion_analysis`,
its independent timestamp and coverage. It omits ranking history and retained-history
metrics. Markdown requests those metrics separately through `getStoryMetrics`;
HTML and metadata share the same request-level article read.

Card reads for home, archive and category listings contain only takeaway,
sentiment and source coverage in their summary. They omit full article/discussion
bodies, legacy points, and analysis previews. RSS and public API lists use a
separate export projection that retains their existing summary strings. Public
API detail and story Markdown retain analysis and evidence. Worker metadata and
raw comments remain private.

The domain contracts live in `lib/story-domain.ts`, independently of database
connections and caching. Missing or null article analysis means unavailable;
it does not promise backfill. An analysis with `status: "no_comments"` is an
explicit analyzed result. Migration/grant fallback and the discussion-rendering
rollback preserve legacy article and public-detail rendering.

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
public analysis contract to show expandable, cited discussion themes.
Each theme places its info icon beside the title and reserves the far-right chevron
for expansion. The info icon opens a small source-comment popup, independently
of the theme description. A close icon, Escape, or clicking outside dismisses
the popup.
Native popovers work without JavaScript; CSS anchor positioning places them beside
the info icon, with a centered fallback in browsers without anchor support.
Native disclosures and ordinary source links
work with keyboard navigation and without JavaScript. Coverage and UTC analysis
time come from discussion fields, independently of the article summary.

New themes replace legacy discussion points. Story HTML and Markdown show a single
**Discussion themes** section without the older introduction or stance cards. The
stored summary string, RSS and public API contract remain unchanged. Historical
claim and stance arrays stay available through the API; new analysis leaves them
empty. Null or absent analysis uses legacy cited points without promising a backfill.
No-comments and empty-theme states explain their limits. Legacy skepticism is never
treated as explicit support.

Run `npm test -- tests/discussion-analysis.test.tsx tests/story-content.test.tsx`.
These tests use the shared `../fixtures/discussion-analysis/valid.json` contract
fixtures and need no live analysis or database.

## Discussion exports

Story Markdown includes themes, source-comment links, sample limitations, and
independent analysis coverage/time. Missing analysis keeps legacy discussion points;
no-comments and empty-theme results describe their limits. Nothing triggers a
backfill or export regeneration.

`GET /api/stories/{id}` adds optional, nullable `summary.discussion_analysis`.
The object explicitly exports status, historical claims/highlights, cited themes, `analyzed_at`,
and `coverage`. Nested fields are allowlisted, excluding worker metadata and raw
source payloads. The list endpoint retains its compact summary; request a detail
for evidence. OpenAPI 1.1.0, HTML docs, and negotiated Markdown docs describe the
same additive contract. Clients should handle absent fields from older responses.

Run `npm test -- tests/api.test.mjs tests/markdown.test.mjs` for shared analysis
fixtures, schema validation, legacy/unavailable states, escaping, and private-field
exclusion. Ajv validates API responses against the published OpenAPI schemas.

## Feed card layout

Top Stories, Latest and topic feeds render the same `StoryRow` content order:
category and ranking context, title, image, excerpt, then metadata and share
actions. The title precedes the decorative image in both visual and document
order. Top Stories alone can label older cards as Archive; the shared fields,
image states, pending excerpt and actions keep the same structure everywhere.

At phone widths (640px and below), cards stack the category, title,
full-width image, then subtitle/excerpt and footer. The image uses its original
proportions, including while loading or showing its error fallback. Cards without
an image go directly from title to excerpt without an empty image row.

Above 640px, the category occupies a full-width row above the image and
content. The image column uses 30% of the available width, capped at 18rem, giving
landscape previews more room. Image height follows its original proportions;
text can make a row taller when needed. The footer aligns to the bottom of the
content column. Narrow desktop cards keep the image beside the title and give
the excerpt and footer the full width. Footer controls wrap when text is enlarged.
Feed headlines use rem units so they scale with the excerpt and metadata when
readers enlarge text. Light and dark themes share the same sizing and layout.

Home, archive and category cards omit discussion themes and the “Read the debate”
link. The title opens the full story, where discussion analysis remains available.
Card queries omit unused discussion payloads. Public exports retain their existing fields.

## Public read limits

`/api/stories/{id}` uses a parameterized primary-key lookup of just the existing
public fields, three summary strings, and the public discussion analysis now in
the detail contract. It does not read ranking views, rank history, or worker metadata. Invalid IDs return an uncacheable
400 before acquiring a database connection. Unknown valid IDs return a cacheable 404. Database failures and cache-capacity failures return a sanitized, uncacheable
503 with `Retry-After: 60`.

| Data cache                   | Positive TTL  | Missing TTL | Maximum entries | Maximum pending distinct keys |
| ---------------------------- | ------------- | ----------- | --------------- | ----------------------------- |
| Public API detail            | 300 seconds   | 60 seconds  | 512             | 8                             |
| Story rendering / Markdown   | 1,800 seconds | 60 seconds  | 128             | 4                             |
| Markdown story metrics       | 1,800 seconds | 60 seconds  | 128             | 4                             |
| API list export fields       | 60 seconds    | n/a         | 2               | 1                             |
| Markdown leaderboard history | 60 seconds    | n/a         | 2               | 1                             |
| RSS data                     | 300 seconds   | n/a         | 1               | 1                             |

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

Archive/category bounds limit offsets, but cache misses still depend on retained
data. Requests across many IDs or instances still require edge rate limiting and
verified origin restrictions. See the
[issue #75 verification report](../../docs/security/issue-75-public-read-limits.md)
for deployment evidence and remaining exposure.

Archive, category, recommendation, and count reads share per-instance data caches
across HTML pages and `/api/browse-stories`. The API delegates to those caches and
still sends `Cache-Control: no-store`; there is no second API cache window.

| Browse data     | Nonempty TTL | Empty TTL  | Maximum entries |
| --------------- | ------------ | ---------- | --------------- |
| Archive months  | 300 seconds  | 30 seconds | 1               |
| Category counts | 300 seconds  | 30 seconds | 1               |
| Archive pages   | 60 seconds   | 30 seconds | 128             |
| Category pages  | 60 seconds   | 30 seconds | 128             |
| Related stories | 60 seconds   | 30 seconds | 128             |

Each cache shares same-key pending loads. One gate permits at most eight distinct
pending browse loads **across all five caches**, including work waiting for the
single database connection. Excess distinct misses become sanitized temporary
unavailability responses (or the existing optional-content fallback); callers can
retry immediately. Completed entries evict least-recently-used entries at their
limits. Expiry is hard: stale entries are never served, and every rejected load is
removed. Empty results are valid short-lived negative entries; database failures
are never cached as empty results. Pages and category/month/story keys are validated
before entering these caches or the pool. The browse-list capability query checks
discussion, image, and slug column grants in one round trip on each cache miss, so
new migration grants become visible after the page entry expires. The legacy
discussion-rendering switch and null-image/null-slug projections still apply.

Cold starts and separate instances each have their own cache and pending gate.
These limits bound one instance's read work and entry count; they are not a
distributed request-rate limit or a byte limit on cached text. No production
origin query-count or pool-wait telemetry was available for this change, so the
TTL and caps are a freshness/load-control policy rather than a measured production
speedup. The [fixture measurements](../../docs/evaluations/issue-143/README.md)
record query and pool-wait effects under repeated browsing. Reassess the policy
with origin and Cloudflare telemetry before extending its TTL or adding layers.

## Discussion rendering fallback

Set server-only `HACKSNAP_DISCUSSION_RENDERING=false` and redeploy to use legacy
summary projections for articles and public API detail. Cards, RSS and public API
lists do not select analysis payloads. Stored analysis and worker generation are
unchanged. Remove the setting and redeploy to restore analysis.
See the [rollout runbook](../../docs/evaluations/issue-42/README.md).

## Share draft lifecycle

Untouched suggested posts follow refreshed story data, including a pending story
that gains a takeaway. Reader edits survive same-story refreshes and closing and
reopening the editor. Reset draft restores the latest suggestion and focuses the
textarea. Changing story identity resets the draft and copy feedback; delayed
clipboard completions cannot update a replacement identity or draft.

## Production browser regression suite

Use Node 22, `npm ci`, and `npx playwright install chromium`, then run
`npm run test:browser:ci`. This builds a credential-free production fixture copy
and runs Chromium journeys, accessibility, responsive layout, and route asset /
rendering budgets. For test-only edits after the build, use `npm run test:browser`.
The suite uses port 3100; override `BROWSER_PORT` when another local app uses it.

Fixtures replace the server-only data module only inside ignored `.browser-app`.
The normal application has no fixture switch, import or endpoint. The runner
copies an explicit source-file allowlist and allowlists only runtime basics in its child
process environment. Browser requests to analytics are served locally and other
external requests fail the suite. Images use generated local WebP variants through
Next's real `srcset` URLs; no live database, Blob service, fonts or credentials
are required. Generated output must never be deployed.

CI stores screenshots, failure traces and route measurements for 14 days. See
[`docs/performance/issue-148-browser-regressions.md`](../../docs/performance/issue-148-browser-regressions.md)
for scenario coverage, measurement definitions, budget review and the release
screen-reader checklist. The existing Jest and production build jobs remain gates.
