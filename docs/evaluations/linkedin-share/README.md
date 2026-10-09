# LinkedIn sharing verification

The LinkedIn action prepares the edited draft for copying, includes the canonical
story URL when absent, and then offers Open LinkedIn. Readers must paste into
LinkedIn’s composer. The URL-only sharing endpoint cannot populate draft text.

Validation on Node 22.23.3:

- PASS: `npm ci`, lint, format check, 414 Jest tests, TypeScript, and production build.
- PASS: 12 Chromium checks across the LinkedIn and existing share-dialog suites.
- PASS: clipboard success and denial at 320px and 1280px, both 100% and 200% text.
- PASS: missing URL restoration, exact Unicode edits, separate navigation gesture,
  canonical share URL, draft-change/reset invalidation, and no draft text in outbound URLs.
- PASS: loading/failed-editor fallback and stale clipboard results after story replacement.
- PASS: Axe WCAG A/AA checks, modal focus containment, close/Escape focus return,
  bounded dialog width, scrolling, and selected manual-copy text.

Design review: the existing dialog, fonts, blue copy action, control sizes and
spacing are retained. The new continuation button separates copying from leaving
the site and gives clipboard-denied readers a manual-copy step. No assets or
animation were introduced. Narrow enlarged-text dialogs scroll vertically; the
manual textarea retains all text and can be scrolled independently.

## Preview investigation and limits

On 2026-10-09, a request with `User-Agent: LinkedInBot/1.0` to
[the sampled story](https://hacksnap.live/story/why-isnt-the-industry-freaking-out-about-deepseek-4-1-flash-50000488)
returned HTTP 200, HTML with canonical and Open Graph metadata in the head, and
an HTTP 200 PNG preview image at `/opengraph-image`.
This does not prove that LinkedIn’s own servers can fetch every story, or that its
cached preview is current. The affected story URL was not supplied, so the reported
preview error was not reproduced or claimed fixed. Pasting the prepared text keeps
the URL available even when the preview fails.

Browser tests stub clipboard results and outbound navigation. They do not sign
into LinkedIn or publish a post. LinkedIn documents the manual paste flow in its
[sharing guidance](https://www.linkedin.com/help/linkedin/answer/a525301), and its
[share plugin](https://learn.microsoft.com/en-gb/linkedin/consumer/integrations/self-serve/plugins/share-plugin)
accepts a URL.

## Screenshots

| View | Evidence |
| --- | --- |
| 320px, normal text, copy success | [Screenshot](linkedin-320-100-false.png) |
| 320px, 200% text, manual copy | [Screenshot](linkedin-320-200-true.png) |
| 1280px, normal text, copy success | [Screenshot](linkedin-1280-100-false.png) |
| 1280px, 200% text, manual copy | [Screenshot](linkedin-1280-200-true.png) |
