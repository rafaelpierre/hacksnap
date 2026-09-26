# Issue #16 acceptance pass

Initial browser pass: `539ad40` (`main`, 26 September 2026), plus the validation changes on `codex/issue-16-acceptance-validation`. The branch now also includes `0470db4`, which brings in #9 (design foundations and system appearance) and #10 (shared feed rows). The browser observations below describe the initial pass; the automated HTTP and theme checks were repeated after the merge. This remains an interim pass until #13, #14 and #15 are integrated and the browser matrix is repeated.

## Automated evidence

The offline fixture is `hacksnap/web/tests/preview-db.mjs`; it includes a pending summary (`90000009`), discussion-only post (`90000010`), unavailable article with no usable discussion (`90000008`), and long headline (`90000007`). No production database is used.

From `hacksnap/web`, with the offline Alembic SQL export and local preview database described in CI:

| Check | Result on this branch |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run test:metadata` | 7 pass |
| `npm run test:theme` | 14 pass after merging #9 and #10 |
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
| Theme control | Not exercised | Dark to light | Initial browser pass only. The merged System/Light/Dark control passes theme and blocked-storage unit checks; repeat browser checks. |
| Keyboard focus | Not yet repeated | Light | Tab moved focus to the story return link. Full keyboard sequence awaits integrated menu and return controls. |
| Share disclosure | Dark | Not yet repeated | The initial native disclosure stayed open on Escape. The merged shared feed row uses a new Share menu; repeat menu focus and dismissal checks on that implementation. |
| Touch targets | Not measured across all controls | 320px | Initial story Share, return link and category badge measured 44px high. The merged styles use the shared 44px touch token; remeasure on the current layout. |
| 200% text zoom, contrast | Pending | Pending | Theme unit checks now cover contrast. Browser zoom and visual contrast inspection remain pending. |
| Denied clipboard, unavailable storage/analytics | Pending | Pending | Exercise the final share menu (#14) and event contract (#15), including manual copy and truthful feedback. |
| Empty lists, loading and error recovery | Partial | Pending | HTTP checks cover missing story recovery and pending/unavailable summary paths. Final rendered empty lists and loading/error journeys still need browser checks. |

## Release blockers and remaining work

1. #13: Read next still leads to a story whose return link is “All stories” at `/`. It cannot preserve the originating Latest page, topic, sort or scroll position.
2. #14: The merged shared row introduces a Share menu, but its menu focus, Escape/outside dismissal, editable post, copy feedback and denied-clipboard fallback still require the targeted browser acceptance pass.
3. #15: Instrumentation and baseline collection are separate. No baseline or targets have been established by this validation pass; shipping instrumentation alone must not close that requirement.
4. Re-run the entire browser matrix on the combined implementation, including light/dark/system, 320px and desktop, 200% text zoom, keyboard/menu focus, denied clipboard and storage, analytics blocked, contrast, and all incomplete and error states. Do not close #7 or #16 with these blockers open.

One framework behavior to keep visible: a missing story renders the not-found recovery boundary, but Next.js may stream it after committing HTTP 200. The acceptance test checks the visible recovery page; a stricter status requirement would need its own routing change.
