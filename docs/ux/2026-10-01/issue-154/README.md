# Persistent homepage resume validation

Issue #154 was tested after rebasing onto the compact-feed changes in #163,
against a local Next.js production build on Node.js 22,
using isolated headless Chrome and a process-local synthetic reader with 37
stories. No production database, credentials, schema or deployment was used.

## Verified behavior

All 16 browser scenarios in [browser-results.json](browser-results.json) passed
with no uncaught page errors. They cover reload/reopened-tab resume; explicit
continuation for an older selection; cursor expiry and server invalidation;
Back to latest with failed storage removal; mobile-width anchor restoration;
Back/Forward and contextual return; blocked local/session storage; throwing
session writes/removal; malformed records and missing-anchor coordinate fallback;
Enter and Space activation with focus moving to the resumed story; and ordinary
cursor pagination without JavaScript.

All eight combinations of 320px/1280px, light/dark, and 100%/200% root text size
had no horizontal overflow. Resume buttons met the shared 44px target in every
combination; measurements are in [layout.json](layout.json).

Representative captures:

- [Desktop dark feed with resume offer](1280-dark-100.png)
- [320px light resume offer at 200% text](notice-320-light-200.png)
- [320px dark resume offer](notice-320-dark-100.png)

Independent code and accessibility reviews led to regression fixes for signed
viewport offsets, input arriving before the first restore frame, automatic-load
races, bounded layout correction, Space activation, and focus after continuing.
Scrolling or clicking plain card text preserves the older checkpoint offer.

## Automated validation

- Locked dependencies installed with `npm ci` on Node.js 22.
- Full Jest suite: 48 suites, 257 tests passed.
- Focused resume regressions passed after the final card-click scope adjustment.
- Lint, formatter check, TypeScript, production build and `git diff --check` passed.

## Limits

These are synthetic-data Chromium checks, not a Safari/Firefox certification,
physical-device test, manual screen-reader audit or production performance
measurement. Cross-device state and seen/opened history remain separate work.
The shared storage hardening contributes to #147; its broader archive/category
browser matrix is not claimed complete by this homepage-focused validation.

## Suspended-frame review regression

The review follow-up starts the two-second settling deadline only after the first
positioning frame. A deterministic regression withholds animation frames while
advancing timers by five seconds and flushing a background checkpoint save. It
reproduced the previous overwrite with `scrollY = 0`, then passed with the fix.
It also verifies that layout corrections do not restart the deadline.

A supplemental isolated Chromium check on the updated production build withheld
animation frames for 3.2 seconds while timers ran. The original checkpoint
remained unchanged, then releasing frames restored the story to its saved
viewport offset within 0.02px, without page errors. See
[suspended-frame-result.json](suspended-frame-result.json). This controls frame
suspension directly rather than relying on nondeterministic background throttling.

## Latest main integration and click regression

Integrated main through #166, preserving the sticky header/topic sidebar and
focus-based automatic-loading controls. The complete automated checks above
passed on this combined revision. The original screenshots and 16-scenario
results predate the navigation changes.

Supplemental production-build Chromium checks verified that Ctrl/Cmd/Shift/Alt
and non-primary title activations, category links, and HN comment links retain
the older checkpoint. Native navigation was suppressed for those events to
isolate the capture handler. Ordinary title navigation and browser Back/Forward
passed with real navigation. The suspended-frame check also passed again, with
no uncaught page errors. Component regressions additionally verify canceled
clicks and that fresh history is ready before the title handler runs.
