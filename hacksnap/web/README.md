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
Markdown responses use `Cache-Control: no-store`. Negotiated HTML pages are
dynamic and uncacheable too, because Next.js replaces their `Vary` header with
its own router headers. This prevents shared HTML caches from bypassing content
negotiation. The existing leaderboard data cache is still shared.
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
Open Graph metadata, and Twitter summary card. Pending summaries use a descriptive
fallback. The metadata and page share a request-scoped database read.

`/feed.xml` returns RSS 2.0 for the latest 50 stored stories ordered by publication
on Hacksnap (`date_added`, then ID). Entries contain titles, canonical links,
stable GUIDs, publication dates, and the takeaway, article brief, and discussion
summary when available. XML values are escaped and invalid XML characters removed.
The feed queries on each request so additions, summary edits, and removals appear
without rebuilding. HTML alternate links and the footer advertise the feed.

Run `node --experimental-strip-types --test tests/rss.test.mjs` and `npm run build`
from this directory. Local integration checks can use the synthetic database
described in the parent README; no production writes are needed.
