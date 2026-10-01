# Story contracts and sharing validation

Issues #144, #145 and #146 are consolidated in one change. Visual checks used
an isolated Chromium browser against a local Next.js development server with a
process-local synthetic reader; no production data or credentials were used.

The story fixture deliberately has an external article with no brief, an older
summary covering 2 comments, and current discussion analysis covering 15 comments.
Before the change, metadata described 2 comments and an obsolete topic. Afterward,
metadata describes 15 comments and the current theme; HTML explicitly labels the
older summary sample separately from the current analysis. The missing article
brief remains correctly identified as an external source.

All eight combinations of 320px/1280px, light/dark, and 100%/200% root text size
passed horizontal-overflow checks for the story and open share editor. All share
buttons meet the 44px minimum target. See [layout.json](layout.json).

Real browser interaction verified that Reset draft restores generated text and
focuses the textarea, and Escape closes the editor and restores trigger focus.
Deterministic component tests cover refresh before first open, preservation of
reader edits, close/reopen, identity replacement, and delayed clipboard completion.

- [Desktop story with separate sample labels](desktop-story.png)
- [320px dark share editor at 200% text](mobile-share-200.png)

These checks cover synthetic Chromium rendering and keyboard focus, not production
performance, physical devices, other browser engines, or a screen-reader audit.

## Combined validation

On Node.js 22, `npm ci`, lint, formatting, TypeScript and the production build
passed. All 53 Jest suites passed (301 tests), including PGlite projection tests,
public format contracts, lifecycle rerenders, and cross-format discussion fixtures.
The byte reproducer is in [issue-144](../../../evaluations/issue-144/README.md).
