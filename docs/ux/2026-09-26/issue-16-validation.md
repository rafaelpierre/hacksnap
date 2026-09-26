# Issue #16 acceptance pass

Source checkout: `539ad40` (`main`, 26 September 2026), plus the validation changes on `codex/issue-16-acceptance-validation`. This is an interim pass. Re-run the matrix after #9, #10, #13, #14 and #15 land; those implementation changes are absent from this checkout. #11 and #12 are present.

## Automated evidence

The offline fixture is `hacksnap/web/tests/preview-db.mjs`; it includes a pending summary (`90000009`), discussion-only post (`90000010`), unavailable article with no usable discussion (`90000008`), and long headline (`90000007`). No production database is used.

From `hacksnap/web`, with the offline Alembic SQL export and local preview database described in CI:

| Check | Result on this branch |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run test:metadata` | 7 pass |
| `npm run test:api` | 4 pass |
| `HACKSNAP_TEST_URL=http://127.0.0.1:3106 HACKSNAP_TEST_STORY_ID=90000001 node --test tests/ux-acceptance-http.test.mjs tests/categories-http.test.mjs tests/markdown-http.test.mjs` | 10 pass |
| `npm run test:db` with `HACKSNAP_SCHEMA_SQL` | 18 pass with worktree permissions |
| `npm run test:categories` | 3 pass with worktree permissions |
| `npm run test:archive` | Route validation passed; local PGlite pagination case stalled on two attempts. CI remains the required gate. |
| `npm run test:history` | Initial ranking cases passed; local PGlite run stalled while concurrent with archive. CI remains the required gate. |

The HTTP checks cover direct Top, Latest, Topics, category, and story requests; rendered TLDR, Discussion and Read next content; source comments and source byline; pending, unavailable and discussion-only explanations; canonical and social metadata; Markdown/HTML negotiation; and navigation recovery. CI runs the new acceptance file against its synthetic production build.

## Browser matrix

| Journey or state | Desktop | 320px phone | Status / evidence |
| --- | --- | --- | --- |
| Top → story → Read next | Dark | Not yet repeated | Reached `90000001` then `90000004` through visible links; story content and controls appeared in the accessibility tree. |
| Latest/archive and Topics → story | Dark | Not yet repeated | Route and server HTML pass; contextual return still waits on #13. |
| Long headline | Not yet repeated | Light | `90000007` had `scrollWidth === clientWidth === 320`; title remained in the accessibility tree. |
| Theme control | Not exercised | Dark to light | Button name updated with the applied theme. System preference support waits on #9. |
| Keyboard focus | Not yet repeated | Light | Tab moved focus to the story return link. Full keyboard sequence awaits integrated menu and return controls. |
| Share disclosure | Dark | Not yet repeated | Opened, but Escape left it expanded. #14 must supply menu focus and dismissal. |
| Touch targets | Not measured across all controls | 320px | Story Share and return link measured 44px high. Category badge measured 44px after rebuild. Share links remain 36px wide until #14 replaces them. |
| 200% text zoom, contrast | Pending | Pending | Run after the final design foundations (#9) and shared row (#10) are integrated. |
| Denied clipboard, unavailable storage/analytics | Pending | Pending | Exercise the final share menu (#14) and event contract (#15), including manual copy and truthful feedback. |
| Empty lists, loading and error recovery | Partial | Pending | HTTP checks cover missing story recovery and pending/unavailable summary paths. Final rendered empty lists and loading/error journeys still need browser checks. |

## Release blockers and remaining work

1. #13: Read next currently leads to a story whose return link is always “All stories” at `/`. It cannot preserve the originating Latest page, topic, sort or scroll position.
2. #14: The current native Share disclosure remains open on Escape; the editable post, separate Copy link, and denied-clipboard flow are still missing.
3. #9 and #10: System theme behavior and the shared feed row are not present on this checkout. The homepage still has the old multi-icon share rows and ranking panels.
4. #15: Instrumentation and baseline collection are separate. No baseline or targets have been established by this validation pass; shipping instrumentation alone must not close that requirement.
5. Re-run the entire browser matrix on the combined implementation, including light/dark/system, 320px and desktop, 200% text zoom, keyboard/menu focus, denied clipboard and storage, analytics blocked, contrast, and all incomplete and error states. Do not close #7 or #16 with these blockers open.

One framework behavior to keep visible: a missing story renders the not-found recovery boundary, but Next.js may stream it after committing HTTP 200. The acceptance test checks the visible recovery page; a stricter status requirement would need its own routing change.
