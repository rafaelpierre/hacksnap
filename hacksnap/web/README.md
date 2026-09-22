# Search metadata and RSS

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
Markdown responses use `Cache-Control: no-store`. Homepage and story HTML use
Vercel ISR with a 30-minute revalidation interval; `/docs/api` stays dynamic.
Vercel runs the proxy before its cache lookup, so Markdown requests rewrite to
the uncached Markdown handler before a cached HTML page can be served.
Next.js replaces the HTML `Vary` header with its own router headers, so an
external CDN must bypass caching for these negotiated page URLs.
Missing stories return 404; data failures return a sanitized 503
with `Retry-After: 60`. HEAD returns the same headers without a body. No token
count is advertised because a tokenizer is not configured.

Run `node --experimental-strip-types --test tests/markdown.test.mjs` for
negotiation and content regression checks. With a production server running,
run `HACKSNAP_TEST_URL=http://127.0.0.1:3000 node --test tests/markdown-http.test.mjs`
to verify HTTP headers, HTML defaults, HEAD, and unaffected API formats.
After deployment, validate with the
scanner from the [Markdown negotiation skill](https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md).

## Search metadata

`/sitemap.xml` lists the homepage and all accessible story pages. Story `lastmod`
values use the latest stored publication, summary update, or snapshot observation
timestamp. They remain stable between content writes; requests do not advance them.
The homepage omits `lastmod` because its ranking can change with time without a
database write. `changefreq` and `priority` are intentionally omitted.

Story pages supply their own title, summary-based description, canonical URL,
Open Graph metadata, and Twitter large-image card. Pending summaries use a descriptive
fallback. The metadata and page share a request-scoped database read.

Social previews use the shared 1200×630 template in `lib/og-image.tsx`.
`/opengraph-image` renders the default brand card; `/story/:id/opengraph-image`
renders the stored story title and source domain, revalidating every 30 minutes.
Long headlines shrink and truncate to fit. Rendering uses the bundled font and
needs no external image/font service or model call. Unknown story IDs return 404.

`/feed.xml` returns RSS 2.0 for the latest 50 stored stories ordered by publication
on Hacksnap (`date_added`, then ID). Entries contain titles, canonical links,
stable GUIDs, publication dates, and the takeaway, article brief, and discussion
summary when available. XML values are escaped and invalid XML characters removed.
The feed queries on each request so additions, summary edits, and removals appear
without rebuilding. HTML alternate links and the footer advertise the feed.

Run `node --experimental-strip-types --test tests/rss.test.mjs` and `npm run build`
from this directory. Local integration checks can use the synthetic database
described in the parent README; no production writes are needed.

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

### Automatic purge after production deployments

The GitHub Actions workflow `.github/workflows/cloudflare-purge.yml` purges
Cloudflare after Vercel reports a successful `Production` deployment. Preview
and failed deployments are ignored. It uses the existing Vercel GitHub
integration and does not require a Vercel function or build-hook changes.

Add these **repository secrets** under GitHub → Settings → Secrets and variables
→ Actions:

- `CLOUDFLARE_ZONE_ID`: the zone ID from the Cloudflare dashboard for `hacksnap.live`.
- `CLOUDFLARE_API_TOKEN`: a custom token with **Zone → Cache Purge → Purge**
  permission, restricted to that zone.

Merge the workflow into the default branch to enable it. After the next production
deployment, check **Purge Cloudflare after production deployment** in GitHub
Actions. Missing credentials or a rejected purge fail that workflow without
rolling back the Vercel deployment. This purges the entire configured zone,
including any other hostnames in it; it does not purge Vercel's own cache.

The filter matches this repository's current Vercel deployment label, `Production`,
and deployment creator, `vercel[bot]`. If the integration's environment name
changes, update the filter. Deployments must emit a GitHub deployment status to
trigger this workflow; CLI-only releases or dashboard promotions without that
event are not covered. Keep the page bypass rules below in place.

References: [Vercel GitHub integration](https://vercel.com/docs/git/vercel-for-github)
and [Cloudflare purge API](https://developers.cloudflare.com/api/resources/cache/methods/purge/).

### Page cache configuration

The homepage and `/story/:id` export `revalidate = 1800`. Both pages are generated
on their first visit through an empty `generateStaticParams`. The homepage uses
an optional catch-all segment that accepts only `/`; all other unmatched paths
return 404 before reading data. Builds need no database connection. Runtime
requests require `HACKSNAP_WEB_DATABASE_URL` with the dedicated `hacksnap_reader` login. The shared
leaderboard data cache also revalidates after 1800 seconds, including API consumers.
ISR serves a stale page while refreshing after the interval, and retains the last
successful page if regeneration fails. This is not a strict 30-minute maximum age.

In Cloudflare, create a **Bypass cache** rule for:

```text
(http.host eq "hacksnap.live" and
 (http.request.uri.path eq "/" or
  starts_with(http.request.uri.path, "/story/") or
  http.request.uri.path eq "/docs/api"))
```

Ensure no later cache rule overrides this bypass. Keep static asset caching
unchanged. Cloudflare page requests still reach Vercel, where warmed HTML pages
should report `X-Vercel-Cache: HIT`. Cloudflare may report `DYNAMIC` or `BYPASS`;
this does not mean Vercel rendered the page again. Preserve request headers and
query strings, including Next.js `_rsc` navigation parameters.

After deploying, request HTML, then Markdown, then HTML for both `/` and a valid
story URL. Verify the content types remain distinct after warming the HTML cache,
and check client-side story navigation. Do not force a shared Cloudflare HTML
cache merely to improve its cache-hit metric.

CI builds before starting the synthetic database, then runs production HTTP checks
with `HACKSNAP_TEST_STORY_ID=90000001` to verify cache TTLs, HTML/Markdown
separation, navigation payloads, and unknown-path 404s.

## Archive

`/archive` lists all retained public stories, including the current Top 10, newest
first. `/archive/YYYY/MM` filters by the UTC month in which a story was added to
Hacksnap. Daily headings use that same date, not the summary update time.
Each page shows up to 30 stories, with ordinary newer/older links and its own
canonical URL. Year disclosures contain links only to populated months.
Archive pages are rendered on request; no schema change is required. The sitemap
includes the archive landing page and populated months. Story URLs stay unchanged.

Run `npm run test:archive` for route validation, UTC boundaries and database
pagination checks against synthetic data.
