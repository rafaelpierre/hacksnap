# Continuous homepage browsing validation

Local validation used the real Next.js homepage and API with a process-local synthetic database adapter containing 37 stories. No production database or schema was accessed. The adapter and development server are temporary and are not part of this change.

## Verified

- The local HTTP API returned 37 distinct stories in batches of 10, 10, 10, and 7. The final batch returned `hasMore: false` and `selectionLimited: false`.
- Malformed cursors, duplicate cursor parameters, and page sizes zero or eleven returned 400.
- All eight combinations of 320px/1280px, light/dark, and 100%/200% root text size had document width equal to viewport width. Measurements are in `layout.json`; representative captures are included here.
- A hydrated browser rendered an appended second batch (20 cards). The top Skip to footer action paused automatic loading and focused the footer, as confirmed by the accessibility tree.
- Automated regression coverage exercises cursor traversal after changing ranks, summary readiness, explicit expiry/invalidation, append/failure preservation, stored-state validation, restoration, and analytics distinctions. Final Node.js 22 checks passed: lint, formatting, 225 tests across 40 suites, TypeScript, and a production build with database credentials removed.

## Remaining browser verification before release

Browser input targeting was inconsistent in the available automation tools: some link/keyboard activations did not execute reliably. Therefore this session does **not** certify full browser Back/Forward and story-return restoration, modified-click/new-tab behavior, JavaScript-disabled traversal, blocked-storage journeys, or throttled-network failure recovery. These require a reliable browser pass before the first release. Component and HTTP tests do not replace that pass. Screen-reader output was not manually audited.

The layout captures use synthetic text and do not establish production loading performance. Production deeper-story opens, exhaustion, return visits, and loading performance remain unmeasured. Record those after shipping #131/#132 before starting #133, using `docs/continuous-browsing/issue-133-plan.md`.
