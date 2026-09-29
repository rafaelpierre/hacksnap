# Continuous homepage browsing validation

Local validation used the real Next.js homepage and API with a process-local synthetic database adapter containing 37 stories. No production database or schema was accessed. The adapter and development server are temporary and are not part of this change.

## Verified

- The local HTTP API returned 37 distinct stories in batches of 10, 10, 10, and 7. The final batch returned `hasMore: false` and `selectionLimited: false`.
- Malformed cursors, duplicate cursor parameters, and page sizes zero or eleven returned 400.
- All eight combinations of 320px/1280px, light/dark, and 100%/200% root text size had document width equal to viewport width. Measurements are in `layout.json`; representative captures are included here.
- A hydrated browser rendered an appended second batch (20 cards). The top Skip to footer action paused automatic loading and focused the footer, as confirmed by the accessibility tree.
- Automated regression coverage exercises cursor traversal after changing ranks, summary readiness, explicit expiry/invalidation, append/failure preservation, stored-state validation, restoration, and analytics distinctions. Final Node.js 22 checks passed: lint, formatting, 225 tests across 40 suites, TypeScript, and a production build with database credentials removed.

## Full browser navigation pass

A follow-up pass used isolated headless Chrome 154.0.8037.58 through Playwright against the built Next.js production server, with the same 37-story synthetic adapter. All 12 scenarios passed with no uncaught browser page errors; raw assertions are in `browser-navigation-results.json`.

| Scenario | Result |
| --- | --- |
| Desktop wheel scrolling | 10 → 20 → 30 → 37 cards, canonical order, no duplicates, exactly three API requests, no runaway requests after exhaustion |
| Append stability | Controlled 800ms response delay; appending preserved scroll position after the wheel gesture settled |
| Deep-story navigation | Back, Forward, and the story return link reconstructed 20 cards and restored the selected story's focus and scroll position within 3px |
| Keyboard/footer controls | Enter activated Skip to footer and focused the footer; automatic loading stayed paused; manual loading and Resume both worked |
| Slow response and HTTP failure | Disabled the load button during a 900ms request; repeated scrolls did not duplicate the request; 503 preserved cards and retry appended successfully |
| Offline recovery | Disconnection exposed retry while retaining cards; reconnecting and retrying loaded the next batch |
| Expired selection | HTTP 410 retained loaded cards and exposed Start a fresh selection, which reset the list |
| Cancellation | Skip to footer aborted a pending append and left manual loading usable |
| Blocked session storage | Story reload, site return, and browser Back reconstructed 20 cards and their saved position using history state |
| Homepage reload | Restarted at the fresh first page; subsequent requests were delayed during the assertion to distinguish restored cards from a new automatic load |
| Modified click | Command-click opened the canonical story in a separate tab without changing the source timeline or its position |
| JavaScript disabled | Ordinary Next/Newer links traversed pages, opened a deep story, and supported browser Back |
| Mobile touch | 320px dark viewport, native CDP touch-scroll gestures through all 37 cards, deep-story tap/Back restoration, no horizontal overflow |

The 12 scenarios include append stability in the desktop scrolling case. Story-reload checks wait for the destination article to render; a URL change alone happens before the SPA transition commits its saved navigation state.

This pass found and fixed a real defect: Resume automatic loading did not re-arm the observer after Skip to footer. The component regression test now exercises that exact sequence. All required Node.js 22 checks passed again: lint, formatting, 225 tests in 40 suites, TypeScript, and a production build with database credentials removed.

Screenshots: [exhausted timeline](desktop-exhausted.png), [desktop restored position](desktop-restored.png), [mobile restored position](mobile-restored.png), and [recoverable loading failure](failure-retains-timeline.png).

## Scope and remaining evaluation

This verifies local production-build behavior with synthetic data in Chromium. It does not certify Safari/Firefox, physical mobile devices, a manual screen-reader audit, or live deployment performance. The earlier browser input-targeting limitation is resolved for these scenarios by the isolated Playwright run.

The layout captures use synthetic text and do not establish production loading performance. Production deeper-story opens, exhaustion, return visits, and loading performance remain unmeasured. Record those after shipping #131/#132 before starting #133, using `docs/continuous-browsing/issue-133-plan.md`.
