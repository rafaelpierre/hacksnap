# Issue #133: bounded related article continuation

Planning note only. **The #132 homepage release has not been confirmed shipped or evaluated here.** Per #130 and #133, implementation remains gated until that release is shipped and evaluated.

## #132 release checkpoint record

Fill this from production evidence after the homepage release. Keep missing evidence explicit; this record is not a pass/fail threshold.

| Evidence | Record |
| --- | --- |
| #131/#132 deployed commit, time, and verified URL | `MISSING` |
| Production deeper-story opens and eligible sessions | `MISSING` |
| Batch loads, failures/retries, and observed end states | `MISSING` |
| Pool state: exhausted, selection-limited, or unknown | `MISSING` |
| Homepage Back/Forward and return-position checks | `MISSING` |
| Loading performance by device/network; sample and percentiles | `MISSING` |
| GA export/query range, test-traffic exclusion, coverage limits | `MISSING` |
| Evaluation findings and whether the #132 checkpoint is complete | `MISSING` |

Review deeper-story opens, pool exhaustion, navigation reliability, and loading performance as #132 specifies. Distinguish fetched batches from actual story opens. The existing analytics documentation says no measured baseline or improvement target is established; do not claim improvement from automatic loads or invent a threshold. Capture evidence and its limitations before starting #133.

## Code seams and proposed shape

- `web/app/story/[id]/page.tsx` loads the canonical story, selects same-category related stories with `getRelatedStories`, and passes them to `StoryContent`. Select the continuation IDs once from the original story; remove the original and duplicate IDs and require usable brief content before taking up to two. Do not recursively select from appended stories.
- `web/app/story/[id]/story-content.tsx` currently combines the page-level article shell, `StoryVisit`, title/source/share controls, brief, discussion, and related cards. Extract a reusable complete article body from page-level breadcrumbs, return context, and continuation orchestration. Keep the original document metadata and route owned by the main page.
- `web/app/related-stories.tsx` and `web/app/journey-analytics.tsx` are the related-card and recommendation exposure/click seams. Reuse the selected IDs as the no-JavaScript/direct-link fallback. Appended articles must not render another related section or be counted as recommendation-card clicks.
- `web/lib/data.ts` provides cached `getStory` and `getRelatedStories`; use the server-only data boundary for full continuation content. `web/lib/story-url.ts` provides canonical standalone links. If #131's frozen public ID/rank cursor is reusable, distinguish `selection_limited` from actual exhaustion so a bounded scan does not claim the pool ended.
- `web/app/discussion-analysis.tsx`, `story-content.tsx`, and `share-links.tsx` contain IDs and article-specific controls. `ShareLinks` accepts an explicit story ID, title, slug, takeaway, and placement, and uses `useId()` for its own disclosure relationships. Pass each continuation's own data through every control and source link.

Keep the main story server-rendered and usable immediately. Load each selected continuation as the reader approaches it, with an accessible pending state, retry, and ordinary direct-story link fallback. Render a complete brief and discussion, clear article boundaries/progression, each article's title/source, and its own sharing controls. Loading failure must leave the main article usable. Scrolling must not change the URL, canonical metadata, or browser history; direct links continue to open the normal story route.

## Risks and verification targets

**Duplicate IDs and broken anchors.** Repeated `StoryContent` currently repeats IDs such as `article-heading`, `discussion-analysis`, `discussion-heading`, and `related-stories-heading`; discussion analysis also uses fixed heading/source IDs. Namespace repeated IDs by story or per-instance prefix, and update matching `aria-labelledby` and fragment references. Render multiple articles and assert every DOM ID is unique and every local reference resolves.

**Cross-article controls.** Verify each article's top/end share controls copy its own canonical URL and use its own title/takeaway. Its external source, HN discussion, and source-comment anchors must retain the correct story IDs. Exercise controls in both articles, not only inspect markup.

**Load versus view analytics.** `StoryVisit` is mount/path based, so it cannot be reused to count prefetched or inserted articles. Define distinct load, visibility exposure, and meaningful-reading semantics before implementation; document event parameters and dedupe keys. Do not count mounting/fetching as viewing. For tall articles, a threshold requiring half of the entire article to intersect is impossible. Consider a viewport-relative sentinel near the article's start plus dwell, or another viewport-sized visibility target; choose and document the rule during implementation. Test observer repeats, retries, remounts, and unavailable observers without fabricating views.

**Selection and partial failure.** Test zero/one/two/many results, blank/missing briefs, original ID, duplicates, stable ordering, and selection limits separately from true exhaustion. A continuation 404/unavailable response must expose retry/direct-link recovery and never hide the main article. Bound requests to two, clean up observers/requests, and ignore stale responses.

**Navigation, performance, accessibility.** Check unchanged URL/canonical/history on scroll, direct standalone links, and homepage Back/return restoration after opening the original article. Test 320px and desktop, system/light/dark, 200% text, keyboard/screen-reader navigation, loading/failure/end states, and throttled-network behavior per `hacksnap/AGENTS.md`. Confirm the initial main article is not delayed and inspect added requests, layout shift, and continuation latency.

## Useful regression coverage

- Selector tests for eligibility, order, duplicate/current exclusion, maximum two, and `selection_limited` versus exhausted.
- Multi-article rendering tests for unique IDs, valid heading/fragment references, progression, per-article source/canonical/share data, and no recursive recommendations.
- Lazy-load tests for no eager fetch, one request per candidate, retry, stale/aborted request handling, max two, and main-content survival on failure.
- Analytics tests proving fetch is not exposure, visibility/read events use distinct semantics, and deduplication survives repeated observer signals/React Strict Mode.
- Browser checks for URL/history/canonical invariance, direct links, Back/Forward and return restoration, and no-JS fallback.

Update `docs/analytics/README.md` and relevant navigation documentation with the final event contract and load/exposure/reading distinctions. After release, record production event delivery, continuation loads/failures, exposures and meaningful reads by position, direct-link use, pool exhaustion/selection limits, navigation outcomes, and main/continuation performance. Include counts, denominators, cohort/device context, export range, and limitations available from the data; avoid treating extra event volume as success. No #132 release evidence or #133 implementation/evaluation is asserted by this plan.
