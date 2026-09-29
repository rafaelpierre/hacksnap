# Mobile feed card stack

At 640px and below the shared feed card displays category/rank, title, full-width
image, subtitle/excerpt, discussion themes, and controls in that order. Above
640px, the image and title retain their aligned top edge and the existing
container-based treatment of narrow desktop cards.

Validated in isolated headless Chrome at 320, 390, 640, 641, 768, 1024, 1280, and
1920px, in light/dark themes and at 100%/200% root text size (32 combinations).
The temporary page rendered the real StoryRow, ArticleImage, and shared layout.
Browser interception served a local SVG for successful image requests and HTTP
404 for the failed-image fixture; no production data or assets were modified.
The two successful images decoded, the missing image was omitted, and React
rendered the failed-image fallback in every measured combination.

`results.json` records category placement, mobile vertical order, full-width
mobile images, desktop top alignment, no empty image gap for image-less cards,
and card/document horizontal overflow. Every check passed. The fixtures cover
ranked/unranked cards, a missing image, a failed image, a missing category, a
pending summary, and discussion themes. Loading reserves the same 4:3 frame as
the rendered image. Existing adaptive-fit behavior is retained.

Keyboard Tab order is category, title, comments, Share. Images remain decorative
and add no keyboard target. The CSS changes do not alter the existing 44px
category/comment/share control targets or focus styling. Screenshots show
mobile and desktop in both themes at both text sizes; `390-card-light.png`
shows the requested mobile sequence clearly.

Validation: 207 tests passed; lint, formatting, production build, typecheck and
`git diff --check` passed. Temporary preview route and servers were removed.
