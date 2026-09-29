# Issue 59 image rendering checks

## Successful image layouts

The `320-*` and `1280-*` captures use the real server-rendered StoryRow and
StoryContent markup and the final application stylesheet. For this local visual
check, scripts were removed and the canonical Blob URL was replaced with an
in-memory SVG fixture. Both images decoded at 1200 × 675; no production asset
was uploaded. The temporary route and servers were removed after validation.

All eight combinations passed: 320px and 1280px, light and dark themes, and
100% and 200% root text size. Each reported document scroll width equal to the
viewport width. Cards stack their image above text at 320px and keep a thumbnail
beside the story at 1280px. The actual browser viewport was resized through CDP.

## Failure and interaction checks

The desktop fallback captures show the hydrated React component after image
errors. Both image wrappers disappear, and the final adjacent-sibling gutter
rule restores the image-less layout. Focused component tests also cover errors
before hydration, invalid/non-ready assets, URL changes after failure, and
canonical host validation. Images are decorative and add no keyboard targets.

The static successful-image captures verify layout, not React hydration or live
Blob delivery. The separate live production pilot remains in
[the rollout guide](../../../image-backfill.md).
