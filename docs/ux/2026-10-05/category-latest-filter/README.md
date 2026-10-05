# Category filters on Latest

Topic links and story category badges open the shared Latest feed at
`/?category=<slug>`. A compact topic indicator and All stories control replace
the separate category header, description and count. Switching topics starts
at page one; pagination and story return links preserve the selected category.
Legacy category URLs permanently redirect and retain their page number.

Browser verification uses the credential-free fixture application. Screenshots
cover populated and empty filters at 320px and 1280px, with 100% and 200% text.
The browser suite also checks both OS appearances, keyboard navigation, no
horizontal overflow, WCAG A/AA accessibility, story returns, Back/Forward,
legacy redirects, invalid filters and the existing asset/rendering budgets.
Rollout regression tests seed old category journeys and packed snapshots, reload
the story, and verify both breadcrumb and generic returns restore the canonical
filtered page, all loaded stories and the saved scroll position.
The UI retains the site's light appearance under both OS settings. The Latest
most-read sidebar also appears on filtered feeds, with optional data streamed
after the required story read starts.

The existing category/page data cache and indexed query remain unchanged.
No production latency or database-load improvement is claimed.

Filtered cards hide their category labels, matching the current topic-card
setting. Analytics regression tests verify query-only topic navigation and
Back/Forward each create a distinct reader visit and visit ID.
