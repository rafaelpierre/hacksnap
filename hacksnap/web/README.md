# Search metadata and RSS

## Typography

Bricolage Grotesque is used for the wordmark, feed and reader headlines, section
headings and related stories. Source Sans 3 carries navigation, metadata, feed
takeaways, reader introductions, article text and About-page copy. Article text matches the byline
font at 1.375rem with a 1.5 line height. All three fonts remain local. Feed lead
headlines use weight 750 and a larger scale; ordinary headlines use weight 700.
Monospace is reserved for code.

Article brief prose separates sentences with one empty line of CSS spacing
(`margin-top: 1lh`), while wrapped lines keep the normal line height. It uses `sbd` sentence
boundary detection during HTML rendering to handle abbreviations, initials,
URLs and decimals. The tokenizer stays in the article renderer's server module
graph. Stored summaries and generation prompts are unchanged; Markdown, RSS
and API responses retain the original text.

Article key points appear under “The bits that matter”, a compact H2 between
the article summary and its bullet list. The heading is omitted when there are
no key points.

The variable WOFF2 files and their licenses live in `app/fonts`. `next/font/local`
serves and preloads the fonts with `font-display: swap` and adjusted fallbacks;
builds and visits do not need an external font service. Newsreader uses an adjusted
Times New Roman fallback, with Georgia and system serifs as additional fallbacks.
Social previews use static local Bricolage Grotesque for headlines and the wordmark,
and Source Sans 3 for excerpts and metadata, matching the feed typography.

## Test dependency override

`@istanbuljs/load-nyc-config` uses js-yaml 4.3.2 through a scoped npm override.
Its YAML loader uses the compatible `load` API; this removes the old argparse /
sprintf-js chain with an unpatched denial-of-service advisory. Keep the override
until the upstream loader updates its js-yaml dependency.

## Color theme

The interface uses a fixed light appearance: #F4F4F5 canvas, white header and
reading cards, and exact #0000FF actions. Filled blue actions use white labels,
with darker blue hover and separate focus rings. Browser chrome remains white.
CSS declares `color-scheme: only light`, including before hydration and when
JavaScript is disabled. OS appearance and previously saved `hacksnap-theme`
preferences do not affect the page. There is no appearance control or theme script.

## Shared design foundations

Navigation links stay outside search-parameter Suspense boundaries so streamed
content cannot replace a focused link. Query-based active-topic indicators update
after hydration; ordinary navigation remains available before JavaScript loads.

All routes share a normal-flow header with Latest and About links aligned right
at desktop widths, desktop topic navigation and Most read sidebar. An underline marks the current main
destination; topic-filtered feeds select their topic instead. Below 60rem, Latest
and About appear above the topic links inside the burger menu. The menu button has a transparent,
borderless 44px target and an accessible “Menu” label. Its native disclosure expands inline below 60rem and
works without JavaScript; Escape closes it and returns focus. The topic-only left
sidebar is sticky above 60rem. At
78rem the 83.5rem shell has a 12.5rem navigation column and an 18rem supporting
rail separated by 24px gaps. Decorative category icons accompany full labels and
44px controls. The DEV mock and approved adjustments are documented in
`../../docs/ux/2026-10-08/frontend-revamp/implementation-plan.md`.
Latest has an accessible page heading without a visible hero or breadcrumb.

Article headers reuse the feed's category and compact relative age as plain text.
The category links to its feed; Latest is available in the main navigation.
Article headers omit the redundant breadcrumb row. Browser Back preserves the
reading journey. Discussion themes
use bordered disclosure cards, with a blue open state and labelled source-comment
actions inside the expanded text. Article headers and home cards share the same
points, comments and curved-arrow Share rail. The Share control opens the sharing
dialog. The article and discussion section anchors remain available for direct
links. Sharing remains in the article header, without a repeated control above
Related stories. Related stories use compact feed-style cards
with takeaways, full-card links and explicit loading, empty and unavailable states.

`app/globals.css` owns the semantic theme colors, relative type scale, spacing,
page/reading widths, responsive gutters and 44px (2.75rem) control target. Use
`--ink` for headlines, `--prose` for reading, `--muted` for metadata, `--accent`
for blue actions and selection. Use `--line`
for separators and `--control-line` for visible control boundaries. Components
share the type, space and layout tokens; future component work should reuse them.
Text uses rem units and wrapping layouts to respect enlarged browser text.

Run `npm run test:theme`, `npm run typecheck` and `npm run build`. Check the shell,
feeds and story at 320px and desktop widths in the fixed light appearance, including 200% text,
keyboard focus and blocked storage.

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
to discard older projections. RSS GUIDs remain stable.

Alternate URLs redirect to the saved canonical address; an older story's numeric
URL renders directly. Markdown GET/HEAD return 308. HTML uses Next.js permanent
redirects, preserving query parameters; when streaming has started, Next.js emits
its standard browser redirect. Routing still resolves the ID at the end of the slug.

Apply migration 0014 before deploying the updated collector. Roll out the website
before the collector to ensure newly inserted slugs are used immediately. No backfill
or production migration is performed by local checks. Rolling back ingestion keeps
saved slugs; rolling back the migration discards them and should be avoided once published.

## Root indexing

Latest lives at `/`, with indexable, self-canonical pagination such as `/?page=2`.
Obsolete ranked `cursor` queries redirect to clean Latest URLs and retain
`X-Robots-Tag: noindex, follow`, including negotiated Markdown GET/HEAD.
Tracking-only queries retain ordinary indexing. Retired archive URLs redirect to
the corresponding root or dated feed and never appear in sitemap entries or
public navigation. These routes remain crawlable so search engines can follow
the redirects; `robots.txt` does not block them.

## Most-read stories by period

The root site layout owns two cards of up to five stories each: “Trending” for
reads in the last seven days, above the lifetime “Most read” card.
Each renders on the initial request to every HTML page, including direct article
URLs, supporting pages and data-outage states. It remains mounted
across client navigation; it does not depend on entering through a feed.
It sits to the right at 78rem and below the main content at narrower widths, including
phones. Its loading, empty and failure states are
independent of the required feed or article and of the other card. Both cards reuse
the same component, with separate rankings and accessible headings.
Links use the stored canonical story slug.
The grid renders its route children immediately. On full-document requests, a
sibling component waits for required route validation and data reads to finish
before starting sidebar reads. This coordination uses React’s per-render cache
and is released on success, outages and routing errors. Within a render, Most
read finishes before Trending starts; Trending still runs if the lifetime read fails.
Streaming requests can display the lifetime result while Trending is pending.
Trending uses a separate, lazily created pool capped at one connection per instance,
so it cannot occupy the primary pool across concurrent requests. Its existing
five-minute cache coalesces concurrent weekly requests into one aggregate. Both
pools use the same reader credentials, verified TLS, read-only transactions,
10-second acquisition/statement timeouts and 90-second idle timeout. The maximum
reader connection budget is two per instance, one primary and one Trending.
Full-document requests await the popularity result so links and terminal states
work without JavaScript. Client-router requests can stream the optional sidebar
when constructing the shell. Existing shells retain their list during navigation;
a full reload fetches it again through the existing five-minute data cache.
Shared HTML pages now render per request, including About and not-found pages,
so their sidebar is not frozen into a build-time empty or failed state. API, image
and other route-handler responses do not render this layout.
Missing-story responses retain their 404 status and show the shared shell after
Next resolves the not-found boundary. Next currently returns an empty error
document for these responses without JavaScript; this does not affect valid
article URLs or handled data-outage responses.
Most read links preserve the loaded feed and scroll position without assigning
the sidebar story as the feed focus, since it may be absent from the loaded cards.

The seven-day ranking counts deduplicated first-party `view` events received in
the last 168 hours, including reads of archived stories. It excludes clicks,
future events, and historical GA totals, which have no per-read timestamps.
Apply migration `0021_weekly_story_popularity` for the partial timestamp index
and scoped reader grants. It retains RLS and keeps visit identifiers private.
Before migration, the weekly reader reports unavailable while the all-time reader
remains usable. Both cards render their respective results, with
ordinary canonical article links that work without JavaScript. Full document
requests await the optional popularity read after required feed data; client
navigation streams its loading, empty, and unavailable states independently.
“Most read” includes the “Across all time” label and ranks lifetime reads.
The weekly reader counts reads over a rolling seven-day period rather
than calculating a rate of growth.

All-time ranking uses `historical_views + story_views`, with HN ID descending as
the tie breaker, across ready story summaries including archived stories. The primary
Latest feed retains its chronological order and pagination. Popularity is an
optional server read with separate five-minute caches for each period; an empty
list or unavailable database has its own message and must not replace the main feed.

First-party `POST /api/story-events` requests contain only `kind` (`view` or
`click`), `story_id`, and a random per-route `visit_id`. Story-page visits come
from the existing valid-story mount lifecycle. Ordinary, keyboard, modified and
middle-click story-link activations are recorded separately, once per route and
target story. Clicks never contribute to the view total. Rerenders, effect replay
and query-only changes do not add views; returning to a story or reloading does.
Collection is best effort and independent of Google Analytics. No JavaScript
means ordinary links work, but these client events are not recorded.

Migration `0019_story_popularity` adds separate historical/live counters and
event receipts; `0020_story_popularity_activation` adds the activation marker.
Both use RLS and narrowly scoped grants. The website reader stays
SELECT-only and cannot read the receipts. The new `hacksnap_counter` role can
write live counters and receipts; it cannot change historical counts. Provision
its LOGIN/password after importing and recording activation, then configure server-only
`HACKSNAP_POPULARITY_DATABASE_URL` with verified TLS. Never put it in a
`NEXT_PUBLIC_*` setting or use an administrator connection for web collection.
Leaving this setting unset disables collection without interrupting reading.

Requests must be same-origin JSON and at most 1 KiB. A per-instance ceiling of
120 events per minute and eight pending writes bounds anonymous bursts. It is
not a distributed anti-abuse limit or proof of human readership. Event receipts
contain route UUIDs, story IDs, event kinds and receipt times, with no stored IPs
or persistent reader identity, and are retained for duplicate detection.

Apply both migrations, preview the historical seed, then import with
`--apply --activate-tracking` before enabling the writer connection. This records
activation in the same transaction as the baseline; the writer accepts no events
until that marker exists. Existing collection evidence or provisioned writer
credentials conservatively freeze the baseline. Once activated, new or changed baselines are rejected,
even with a supplied cutoff; an identical reimport is safe. Database receipt times
cannot establish when the browser emitted a view. The supplied seed has six
story pages and 392 standard GA
Views, with an unspecified exact export cutoff. Counts therefore represent the
supplied baseline plus observed live activity. Refresh the GA snapshot before
activation when possible; otherwise the intervening interval is unmeasured.
See [the importer](../../data/seeds/README.md) for safe preview and replacement
commands. Roll back collection by removing the writer setting; preserve
accumulated tables and counts.

## Latest continuation and return navigation

`/` renders the canonical Latest feed. `/?page=N` serves subsequent pages, and
`/YYYY/MM` filters by UTC month. Obsolete ranked cursors are discarded through
redirects. Unknown root paths and invalid page parameters return 404.
Latest orders published stories by date added, newest first, and loads 15 stories
per request. Topic and dated archive feeds use the same batch size. Stories with
missing or blank published takeaways are filtered before limits, offsets and
counts; they remain available at their existing detail URLs.

Near the bottom, the feed appends the next batch. A visible Load more button and
server-rendered Newer/Older links preserve navigation when automatic loading or
JavaScript is unavailable. Failures keep loaded cards visible and offer a retry.
Automatic loading stops while continuation controls have keyboard focus.

Opening a story saves loaded cards once per listing entry in tab-scoped session
storage. Browser Back/Forward and explicit story returns restore the loaded depth,
scroll position and focused story. Blocked or full storage falls back to same-tab
memory. Feed records retain the existing bounded storage budgets and eight-hour
expiry. Older snapshots without the current page-size marker are rejected so pagination and pending
stories cannot reappear from a saved feed. Reloading Latest restores a valid
listing record; the former root-only ranked checkpoint no longer applies.

The header scrolls with the document. Desktop topic navigation sits to the left
of the feed and remains sticky with a small offset from the viewport top.
Cards show compact time since first added as plain text. The time element retains
the exact timestamp and accessible label, with a UTC date fallback before JavaScript
loads. Stories become opened only after
visiting their detail page, never merely by loading or scrolling the feed.

The legacy `/api/ready-stories`, `/api/story-freshness` and leaderboard endpoints
retain their ranked contracts for existing API clients. Their selection cursors
and ranking do not control the Latest interface.

On iPhone and iPad, article links start a normal document navigation during the
user's tap. This avoids WebKit skipping a history entry when an asynchronous
client navigation finishes after user activation expires. It costs a full page
load. Feed, Most read and Related stories links use the same behavior. A transient
`journey` query token carries the saved listing context across documents and is
removed after hydration. If browser storage is blocked, native Back remains
available, but the explicit return link may fall back to the default feed.

Initial date labels use deterministic UTC text, then switch to the reader's locale
after hydration; Node and WebKit can produce different punctuation from `Intl`.

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

Legacy ranked-feed analytics events `home_story_open` record actual activations after the
first ten (`story_id`, 1-based `position`, `placement=home_feed`). Rendering or
fetching a card never emits that event. `home_feed_load` records each attempted
automatic or manual request with `trigger`, `outcome` (success, empty, failure,
expired, cancelled) and resulting `position`; `home_feed_end` records exhausted versus capped
selections once per route occurrence. These are client events and do not fire
without JavaScript. A cancelled request records its original trigger and the
number of loaded stories at request start exactly once, whether its aborted fetch
rejects or later resolves; it does not also record success or failure. Latest uses the existing browse journey events; the ranked-only events above
do not fire on Latest. `story_view` still records a rendered story page.

Run `npm test -- tests/home-feed-state.test.mjs tests/story-navigation.test.tsx
tests/navigation-context.test.mjs tests/analytics.test.mjs` for continuation,
return, and event contract coverage.

## Markdown content negotiation

`/`, `/YYYY/MM`, and `/story/:id` return Markdown when requested with
`Accept: text/markdown` or a recognized AI user agent: `ChatGPT-User`,
`OAI-SearchBot`, `GPTBot`, `Claude-User`, `Claude-SearchBot`, `ClaudeBot`,
`PerplexityBot`, or `Perplexity-User`. Agent product tokens are matched
case-insensitively, including versioned user-agent strings. Matching agents receive
Markdown even without an Accept header or when they request HTML.
Other clients retain HTML as the default, including wildcard requests.
For those clients, Accept quality weights are respected; Markdown wins a tie when
explicitly requested. This behavior applies to GET and HEAD only.
The root URL renders Latest for both HTML and Markdown requests. JSON APIs,
RSS, metadata endpoints, and static assets retain their existing formats.

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
The leaderboard uses a bounded 60-second per-instance data cache. Latest and story HTML
render per request. The proxy rewrites Markdown requests to the
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

Story HTML shows an evidence-qualified skepticism block for legacy discussions.
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

The canonical homepage at `/` uses `Hacksnap | AI News` for its search,
Open Graph and Twitter titles. The shared layout supplies `WebSite` structured
data naming the site `Hacksnap` at `https://hacksnap.live/` so search engines can
recognize the brand. Later Latest pages, monthly archives and other pages retain
their own `<page title> | Hacksnap` titles.

The favicon uses the header's square white `h/` mark on charcoal (`#24242b`). Next.js
serves `app/icon.svg`, a 96px `app/icon.png`, a multi-size `app/favicon.ico`, and
a 180px `app/apple-icon.png` through its file-based metadata routes. Regenerate
the raster copies from the SVG with `node scripts/generate-icons.mjs`.
Google chooses its displayed title, site name, and favicon after recrawling;
deploying these preferences does not immediately change existing search results.

`/sitemap.xml` lists the canonical Latest feed, archive pages, and stories with published takeaways. Story `lastmod`
values use the latest stored publication, summary update, content snapshot, or ranking observation
timestamp. They remain stable between content writes; requests do not advance them.
The Latest landing page omits `lastmod`; story timestamps retain their stored values. `changefreq` and `priority` are intentionally omitted.

Story SEO titles use `<headline> | Hacksnap`, keeping the original article title
as the H1. Preview headlines are shortened to 60 characters. Open Graph and
Twitter titles use the shortened headline without an added reaction label. Descriptions use the actual sampled-comment count and
up to three existing discussion-point titles, with 155-character search and
125-character social targets. Discussion-only summaries do not claim article
coverage, and zero-comment samples are identified explicitly. Each story also
supplies its canonical URL and Twitter large-image card. Missing or blank published takeaways use a descriptive
fallback and `noindex, follow`, and are excluded from the sitemap. Once a takeaway is
published, the story enters the sitemap and becomes indexable on the page's next
revalidation (the existing cache interval is 30 minutes). The metadata and page
share a request-scoped read backed by the bounded per-instance story cache.

Social previews use a ready publisher-sourced Vercel Blob asset when one passes the public
image contract. Generated, pending, failed, missing, or malformed assets use the shared
1200×630 brand card at `/opengraph-image`, rendered by `lib/og-image.tsx`.
The story metadata declares that choice directly because a story-level
`opengraph-image` file would take priority over it. The legacy story preview
URL remains an ordinary route handler, so old links redirect to a ready asset or
return the brand card without changing metadata. The brand card uses the bundled
fonts and needs no external image/font service or model call. It follows the
frontend's light gray canvas, white reading card, charcoal headings, and blue
source/domain accents. The square mark preserves the header identity at small
sizes; generous card padding keeps headlines readable in social feeds. The old
grain texture is no longer loaded by the renderer.

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

Story links retain their `aria-busy` state during client navigation without
adding visible status text beneath the link.

Latest and topic links show a small pending indicator during a
client-side navigation. The links retain their ordinary destinations and native
modified-click behavior. For client navigation, once the server has validated an initial feed request,
it streams the page heading and navigation with three decorative story-card
skeletons while the required stories load. Loading is announced once for the
feed; placeholder cards contain no focusable controls. Both indicators respect
reduced motion and the current theme.

The suspense boundaries sit after route validation so invalid routes do not flush
successful HTML before returning 404. Later pages keep
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

Latest and `/story/:id` render per request so outages cannot become cached
HTML. The root catch-all accepts `/` and valid `/YYYY/MM` selections; unmatched paths
return 404 before data access.
Builds need no database connection. Runtime requests use `HACKSNAP_WEB_DATABASE_URL`
with the dedicated `hacksnap_reader` login. Leaderboard data uses a bounded
60-second per-instance cache with one entry and one pending load. The shared selection
contains the first ten cards, bounded continuation IDs/ranks/recency flags, ingestion
time, and observation time from one SQL statement. `getLeaderboard()` and the first ready-stories API page read that same cached
snapshot. Markdown reads ranking history separately with a bounded 60-second cache.
Concurrent callers share a load; after expiry they wait for fresh data, and failures use the existing
unavailable response rather than returning stale rankings. Separate instances can
differ within that one-minute window. This applies to the legacy ranked APIs; it also refreshes ranking changes caused by the 24-hour recency cutoff.
Story data uses the bounded per-instance cache documented below. Story HTML waits
for the required story and canonical URL check, then streams the article while
the optional "Related stories" query resolves. Category HTML waits for its required
story list and page check, then streams the optional count. This ordering matters
because these reads share one primary pool connection per instance: optional reads begin
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
  starts_with(http.request.uri.path, "/story/")))
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

## Latest and dated feeds

`/` lists retained stories with a published takeaway, newest first. `/YYYY/MM` filters by the UTC month in which a story was added to
Hacksnap. Feeds render one continuous chronological list without date groupings.
Latest, dated archives, and topic listings reuse `app/story-feed.tsx`
for automatic loading near the end of the feed, failed-load retries, accessible
status announcements, and story-return restoration. Server routes own filtering
and ordering; Latest, dated archives and topics use a continuous unranked list.
Each archive/topic request loads up to 15 stories through
`/api/browse-stories?path=...&page=...`, using the same bounded data readers as HTML.
Pending briefs are excluded before pagination. Server-rendered Newer/Older stories links and
canonical URLs work without JavaScript. The Older stories link advances to the
next unread page as automatic loading appends rows and disappears at the end;
Newer stories returns to the page before the requested listing page. Loaded rows are deduplicated and saved with the exact listing
URL in browser history for back/forward and explicit story returns. Archive/topic
pagination retains its existing live offset ordering, so new arrivals can shift
page boundaries during browsing; it does not freeze a ranked selection.
Duplicate-only archive/topic batches still advance the page, so subsequent loads
can reach older stories. Frozen ranked batches retain the no-progress guard.
Archive and category listings accept pages 1–100 (at most 1,500 stories and an SQL
offset of 1,485). Larger pages return 404 before data access;
the final allowed page has no older-page link. Use dated archive URLs to reach
older archive entries. Categories show their latest 1,500 stories; deeper category
browsing needs cursor pagination before this limit can be raised. The Latest feed starts
close to the header beside the left topic menu; dated archives retain their compact month heading.
After more than 80 rows are loaded, the browser keeps a measured 80-row window in
the DOM and uses spacers for the rest of the feed. The active window follows scroll,
deep return restoration, and keyboard focus near either edge. This bounds React
and DOM work while preserving the
feed's physical scroll height and accessible list position.
Archive pages are rendered on request; no schema change is required. The sitemap
includes the archive landing page and populated months. Story URLs stay unchanged.

Run `npm run test:archive` for route validation, month boundaries and pagination parsing unit tests.

## Category flairs

Story pages show up to two **Related stories** after the discussion,
at the end of the article. They exclude
the current story, pending briefs, future-dated stories and invalid public IDs,
and sort by date added descending, then story ID descending. Each shows its
category, headline and source domain, followed by a link to browse the category.
Stories with no qualifying next reads or no category link to the latest archive
instead. The section is server-rendered and streams after the required article
content, using a separate optional read. It uses the existing category/date index and requires no
migration. `npm run test:categories` covers category routing and navigation context.

Stories display a compact category flair on feeds and article pages. Clicking a
flair or topic link filters Latest at `/?category=<slug>`, newest first. The same
feed shell highlights the selected topic in the shared navigation, where Latest
clears the filter. Topic feeds start directly with stories, without an extra topic header.
Changing topics starts at page one; pagination, automatic loading and story returns
retain the selected category. Saved legacy category journeys and feed snapshots are
normalized on read, preserving their page, loaded depth, focus and scroll during
the existing eight-hour retention window. Mobile readers can choose a topic through the native “Topics & menu” disclosure.

The six filters use stable slugs from `lib/categories.ts`, paginate at 15 published
stories, and return 404 for unknown, repeated or empty categories and invalid pages.
Category filters apply only to the root Latest feed. Old `/category/<slug>` URLs
permanently redirect, preserving the page number. Canonicals and sitemap entries
use the filtered Latest URLs. HTML and negotiated Markdown share the category
reader, which filters before pagination and retains its category/page cache key,
60-second nonempty TTL, 30-second empty TTL and pending-load deduplication. Category
counts are no longer requested by filtered feeds. `lib/category-metadata.ts`
provides stable, topic-specific search titles and descriptions explaining the
article summaries and Hacker News discussions, independently of short navigation
labels and visible introductions. Search, Open Graph, and Twitter copy agree;
later pages add their page number and keep self-referencing canonical URLs.
Article takeaways remain in server-rendered HTML rather than being concatenated
into metadata. API responses expose the
nullable category identifier; Latest and article Markdown include category links.

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

The scoped `@istanbuljs/load-nyc-config` override uses `js-yaml` 4 to remove the
unpatched `sprintf-js` dependency pulled in by `js-yaml` 3. Its YAML `load` API
remains compatible with the coverage loader. Remove the override when the
upstream loader no longer requires `js-yaml` 3. Dependency audits include both
runtime and development packages.

## Canonical article images

Migration `0015_article_images` adds nullable image fields to
`hacker_news_threads`. Migration `0022_image_source_reader` grants the web reader
SELECT on the existing `image_source_type` column. The reader checks that all six
fields and their column grants are available on each uncached story read. Before the migration,
or while its reader grant is unavailable, pages and feed responses use
null image fields and keep their ordinary text layout.

Queries only return image metadata for publisher sources (`og`, `twitter`, or
`json_ld`). Generated fallbacks, missing source types, and unknown source types
return null image fields across feeds and story pages. No stored
assets are deleted and image generation remains unchanged. Older saved feed
snapshots are invalidated so they cannot restore generated images.

The interface only renders records with `image_status = 'ready'` and an HTTPS
URL on a `*.public.blob.vercel-storage.com` host. It never reads or exposes the
publisher source-image URL. Missing, pending, failed, and malformed records omit
the image wrapper. Browser load errors keep a branded placeholder in the reserved
frame while preserving the card or story content. Until source descriptions are stored, the supplementary images use an
empty alt attribute so the headline remains the accessible label. Detail images
retain their supplied intrinsic dimensions. Feed images also keep their original
aspect ratio: they span the card's padded content width and their height is automatic,
so the complete image is visible without cropping or letterboxing. Error
placeholders preserve the stored aspect ratio. This applies to Latest, archive and
category feeds. Social Open Graph images retain the existing generated template.

Feed and detail images use the built-in Next image optimizer with layout-specific
`sizes`, eight candidate widths from 128 to 1600 px, and one quality (75). The
optimizer accepts only HTTPS `*.public.blob.vercel-storage.com/articles/**` URLs
without a query string or redirects, after the ready-image contract above has
validated the URL and dimensions. The first eligible image in the initial listing
uses eager/high priority in server HTML. If the lead story has no ready image,
the next image-bearing initial story receives priority. The browser can discover
that image before hydration; a deep restored feed may fetch it before the client
restores its scroll position. Subsequent and appended images remain lazy.
Restored feed visits stay lazy after scroll positioning settles. The detail hero uses eager/high priority. This
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

Card reads for archive and category listings contain takeaway,
sentiment, source coverage and a bounded current discussion excerpt in their summary.
They omit full article/discussion bodies, legacy points and analysis evidence. RSS uses a separate export projection that retains its existing summary strings.
Story Markdown retains analysis and evidence. Worker metadata and
raw comments remain private.

The domain contracts live in `lib/story-domain.ts`, independently of database
connections and caching. Missing or null article analysis means unavailable;
it does not promise backfill. An analysis with `status: "no_comments"` is an
explicit analyzed result. Migration/grant fallback and the discussion-rendering
rollback preserve legacy article rendering.

`tests/discussion-projection.test.mjs` runs the shared contract fixtures, legacy
and pending rows through embedded PostgreSQL with the migration's reader grant.
It verifies detail completeness, compact feeds and denied private-column reads
without credentials or a database server. PGlite is a test-only dependency.

## Data outages

Database connection and query failures become sanitized availability errors.
Frontend pages show a retry action inside the normal navigation; these responses
opt out of caching. Latest and story pages render per request so a transient
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
work with keyboard navigation and without JavaScript. The info icon beside the
section heading opens coverage, UTC analysis time, and sampling limitations;
these details are hidden until clicked and come from discussion fields,
independently of the article summary. The section omits the full HN discussion
footer link; theme source-comment links remain available.

New themes replace legacy discussion points. Story HTML labels the section
**Discussion analysis**. The article summary appears without a visible section heading.
Markdown retains **Discussion themes**. Both omit the older introduction and
stance cards. The
stored summary string and RSS remain unchanged. Historical
claim and stance arrays remain stored; new analysis leaves them
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

## Feed card layout

Latest, dated and topic feeds share this order: category and compact age, headline,
takeaway, optional discussion preview, full-width inset image, then a compact
rail with an up-arrow points count and a comment-count link to Hacker News.
The counts use neutral pills, with blue hover/focus feedback on the comment link,
screen-reader labels and a 44px touch target. The points count is informational.
The headline opens the brief; duplicate brief, analysis and Share actions are
omitted from cards. Categories stay visible even in
filtered feeds. Missing images omit the media container; failed requests reserve
the source aspect ratio. All images retain intrinsic proportions without cropping.

All cards use the same headline, excerpt and padding styles, including the first.
Each card with available current discussion topics shows a “Discussion summary”
widget, with a blue heading and decorative Lucide sparkle icon using the
`--discussion-summary-heading` token, which follows the shared accent color. The feed
query selects up to two nonblank topic summaries, bounded to 440
characters before the public feed serializer makes a 220-character excerpt.
The excerpt travels with its story through pagination, virtualization and session
restoration, without extra detail queries. Legacy summaries and unavailable analysis
omit the widget. Full discussion payloads stay out of public cards and snapshots.

The first eligible initial image receives eager/high priority; subsequent images
remain lazy. Responsive image sizes reflect actual shell and card padding. Cards
are measured for virtualization, with intrinsic image ratios used for estimates.
On the story page, Share opens a native modal with focus containment, Escape,
editable drafts and manual-copy recovery. Headline links preserve feed context.

## Public read limits

| Data cache                   | Positive TTL  | Missing TTL | Maximum entries | Maximum pending distinct keys |
| ---------------------------- | ------------- | ----------- | --------------- | ----------------------------- |
| Story rendering / Markdown   | 1,800 seconds | 60 seconds  | 128             | 4                             |
| Markdown story metrics       | 1,800 seconds | 60 seconds  | 128             | 4                             |
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
summary projections for articles. Cards and RSS do not select analysis payloads. Stored analysis and worker generation are
unchanged. Remove the setting and redeploy to restore analysis.
See the [rollout runbook](../../docs/evaluations/issue-42/README.md).

## LinkedIn sharing

LinkedIn’s URL share dialog cannot prefill post text. The LinkedIn action copies
an edited draft with the canonical story URL and reveals **Open LinkedIn**. Paste
the copied text into LinkedIn’s composer; the URL stays in the post even when a
preview is unavailable. Denied clipboard access shows selected text for manual
copy before leaving. Loading and failed-editor states use the same flow.

## Share draft lifecycle

Untouched suggested posts follow refreshed story data, including a pending story
that gains a takeaway. Reader edits survive same-story refreshes and closing and
reopening the editor. Reset draft restores the latest suggestion and focuses the
textarea. Changing story identity resets the draft and copy feedback; delayed
clipboard completions cannot update a replacement identity or draft.

## Production browser regression suite

Use Node 22, `npm ci`, and `npx playwright install chromium webkit`, then run
`npm run test:browser:ci`. This builds a credential-free production fixture copy
and runs Chromium journeys, accessibility, responsive layout, and route asset /
rendering budgets. iPhone WebKit also checks arrival from another site, article
redirects, slow responses, and Back/Forward navigation. For test-only edits after the build, use `npm run test:browser`.
CI runs Chromium on Linux and iPhone WebKit on macOS to exercise Apple's WebKit
port. Linux WebKit can report canceled prefetches as access-control errors during
document navigation; the macOS job keeps the strict browser-error checks enabled.
The suite uses port 3100; override `BROWSER_PORT` when another local app uses it.
CI runs tests in parallel with one Playwright worker per logical CPU, including
tests within the same file. Local runs default to four workers; use
`npm run test:browser -- --workers=100%` to reproduce CI concurrency.

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

Category-only and paginated navigations use pathname plus sorted search parameters
as the analytics route identity, shared by ReaderVisit and event tracking. Each
route occurrence gets a new visit ID and reader_visit; rerenders and reordered
query parameters deduplicate. Transient journey tokens are excluded, and query
values are never added to engagement event fields. Category labels appear on all
feed cards, including selected topic feeds.
