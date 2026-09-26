# Issue #27 — visual parity follow-up

Branch: `codex/issue-27-visual-parity`, based on `4f51a5c`. Reference: the final design decisions and PR #8 prototype in the parent directory. The user’s comparison at `http://127.0.0.1:8773/comparison/index.html` was inspected, including its home, story and Topics screenshots.

[Open the before/after viewer](index.html). Serve this repository’s `docs/ux/2026-09-26` directory with `python3 -m http.server 8774 --bind 127.0.0.1 --directory docs/ux/2026-09-26`, then open `/issue-27/index.html`.

## Changes

- Wider feed, restrained 27px lead headline (23px on phone), small inline ranks, topic/source context above the headline, quieter activity and Share controls below. All three feeds use the shared component.
- Reading-list date and approved homepage headline; selected All stories and About explanation in the desktop topic rail.
- Topic/source, title, short deck, then neutral TLDR;. Skepticism remains tied to the original classifier and now sits beside Discussion. Compact recommendations retain actual topic/source metadata and topic continuation.
- Topic tiles have content-driven height and keep live counts, without fixed-height overflow.
- New generated takeaways have a 220-character schema limit and explicit instructions to retain the main caveat. The prompt version is bumped. Existing long takeaways use a bounded excerpt, preferring complete sentences or an opening semicolon-delimited clause. Their **entire original takeaway stays visibly rendered in TLDR;**; sharing, API responses and stored data remain complete. No CSS line clipping or hard-coded mock copy is used.
- The narrow-screen Share popup previously extended 174px off the left edge when the trigger wrapped. Right alignment now keeps it in view.
- Story links now show an announced Opening story… status during delayed client navigation, retaining canonical URLs and saved list context.
- Try again now refreshes server data as well as resetting the error boundary. A real disposable-database outage reproduced the old failure and verified recovery after the fix.

## Measured comparisons

Chrome; 1280 × 720 and 320 × 720; dark and light; local production build and isolated PGlite fixture databases. Full-page captures retain the same layout viewport. The reference’s 16px outer preview frame is not added to production.

| Measurement | Before | After |
| --- | --- | --- |
| Desktop feed headline x | 200px (rank gutter included) | 38px |
| Desktop sidebar x | 944px | 1036px |
| Topics directory bottom | 855px | 627px |
| Fixture story TLDR; y | 547px | 422px |
| Real story 49849985 TLDR; y, desktop | 648px | 422px |
| Real story 49849985 TLDR; y, 320px | 940px | 543px |

`captures/before` and `captures/after` cover Top, Latest, topic feed, Topics and the same fixture story in all four width/theme combinations (40 captures). Those pairs use the original synthetic dataset; the extra long-takeaway regression fixture was subsequently added for automated coverage. `captures/real-story-*` adds eight captures of the exact public comparison story. The public API snapshot is saved in `public-story.json`; its article, discussion and takeaway text are real, while local fixture coverage is synthetic and sentiment is deliberately unavailable. Counts and recommendations are not visual-parity assertions.

The appearance was forced for matched captures; the native selector can still display the previously stored preference. System behavior was tested separately with storage denied. Header/copy geometry and both themes were visually inspected. There was no horizontal page overflow in the captured matrix or text-zoom checks.

## Verification

- Production build and TypeScript: pass.
- Pipeline: 63 tests pass, including rejection of generated takeaways over 220 characters.
- Theme/contrast, sharing, navigation context and social metadata: 29 tests pass.
- New short-takeaway tests: 3 pass; wired into CI via `npm run test:brief`.
- Category and recommendation database tests: 3 pass with Node 24, serial execution. The initial Node 23 PGlite run stalled and was stopped.
- Production HTTP checks: 12 pass, covering source attribution, metadata, Markdown negotiation, cache headers, route recovery, compact header/recommendations, and full legacy-caveat preservation.
- `journeys.py`: 114 browser assertions pass. Top/Latest/topic → story → next → return in both themes and widths; menu focus, Escape restoration, denied-copy/manual text, popup bounds; 200% root text sizing on home, Topics, long headline, pending, unavailable and discussion-only pages.
- Additional browser checks: System appearance follows OS light/dark with local/session storage blocked; canonical story navigation and home fallback still work with storage and analytics blocked; successful canonical copying and exact edited-post copying; focus-out dismissal; visible keyboard focus; 44px source/topic/share/return targets.
- Empty Latest and the unavailable-database error screen render in all four layouts without overflow. Try again recovers after reconnection using the keyboard. `captures/error-*` and `captures/recovered-320-dark.png` record this.

## Reproduction

Use the offline schema export described in CI. From `hacksnap/web`:

```sh
npm ci
HACKSNAP_SCHEMA_SQL=/path/to/schema.sql HACKSNAP_PREVIEW_PORT=55437 node tests/preview-db.mjs
# In another terminal:
npm run build
HACKSNAP_WEB_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/postgres npm start -- --port 3127
HACKSNAP_TEST_URL=http://127.0.0.1:3127 HACKSNAP_TEST_STORY_ID=90000001 node --test tests/ux-acceptance-http.test.mjs tests/categories-http.test.mjs tests/markdown-http.test.mjs
```

Optional fixture flags: `HACKSNAP_PREVIEW_EMPTY=1` for empty/error checks; `HACKSNAP_PUBLIC_STORY_FIXTURE=/absolute/path/to/public-story.json` for the public snapshot. Use separate ports/databases. These do not connect to production.

The saved browser-harness scripts use port 3127 and write to `/private/tmp/issue27-evidence`. Invoke `capture.py` with `phase='before'` or `phase='after'` in the harness namespace; run `journeys.py` after selecting the local preview tab. Captures require the browser-use harness and an enabled browser connection.

## Acceptance boundaries / issue #16

This is an implementation and substantial acceptance pass, **not a claim that #16 is closed**. The initial delayed-fetch check exposed missing navigation feedback; visible, announced progress was added and checked with a deterministic delayed response. Latest scroll-position restoration, browser Back/Forward, and pointer-outside dismissal were also exercised at 320px. Keyboard context/return, Escape and focus-out dismissal passed the four-layout journey matrix. Direct-arrival server Suspense timing and a screen-reader audit are not claimed by this manual pass.

No production summary regeneration was run. The tighter schema/prompt applies to newly generated summaries; the existing pipeline refreshes sentiment for already summarized stories, so historical takeaways retain the explicit excerpt/full-text treatment until separately regenerated. Live inference against the tighter schema remains a rollout check.

Reader measurement baselines and targets from #16 have not been established. Instrumentation or these local checks must not be used as evidence that a production measurement baseline exists. No deployment, issue closure, or production data mutation was performed.

## Integration with current main

Merged `2f93273` from main after the engagement work landed. The visual changes now live in main's extracted `StoryContent` component; story visits, recommendation exposure/clicks, share placement, return tracking, and return-cohort fixes are preserved. CI runs both the brief and mocked story UI suites. Compact recommendation and legacy-caveat assertions also run in the database-free UI tests.

Post-merge validation: production build and TypeScript pass; 5 story UI, 12 analytics, 3 brief, 6 share, and 10 production HTTP checks pass. Two former HTTP-only story checks were migrated on main to mocked UI coverage and were not restored as duplicate fixture-dependent tests.
