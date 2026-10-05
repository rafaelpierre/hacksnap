# Latest-only feed

Captured from the production-built browser fixture application with local images
and deterministic public story data. These screenshots contain no production data.

Latest renders directly at `/` and replaces the ranked homepage and its hero.
Dated feeds use `/YYYY/MM`. Sitemap and navigation use only these canonical paths. The vertical desktop
topic menu remains on the left and starts close to the header beside the feed.
Phones retain topic access through the header. The accessible page heading remains in the
document. Stories form one continuous list without date groupings. Each initial
and subsequent browse batch contains at most 15 stories
with published takeaways, filtered in SQL before pagination.

Screenshots:

- [Desktop, light OS setting](latest-1280-light-100.png)
- [Desktop, dark OS setting](latest-1280-dark-100.png)
- [Phone, light OS setting](latest-320-light-100.png)
- [Phone, dark OS setting](latest-320-dark-100.png)
- [Phone, 200% text](latest-320-light-200.png)
- [Empty topic, desktop](empty-topic-1280-light-100.png)
- [Empty topic, phone](empty-topic-320-light-100.png)
- [API docs return link, phone at 200% text](api-docs-320-light-200.png)

Browser verification covers 320px and 1280px, light/dark OS settings (the interface stays light), 100%/200% text,
document overflow, WCAG A/AA axe checks, keyboard navigation of the left topic menu,
history and story returns, continuation/retry, and ordinary pagination without
JavaScript. SQL regression tests execute against embedded PostgreSQL and cover
missing, null, empty and whitespace-only summary takeaways before limits and
offsets, matching counts, and direct access to pending story pages.
