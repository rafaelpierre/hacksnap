# Search metadata and RSS

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
