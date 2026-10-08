# Image format experiment

This is a local synthetic encoding comparison using the unchanged browser fixture
SVG, not a measurement of production photography or visual quality.

At the selected 640px feed width, WebP at quality 75 uses 2,192 bytes. AVIF at the
same quality uses 2,229 bytes. Next's nominal quality 75 maps to AVIF quality 47
and effort 3; encoding a pipeline-like 1600px WebP source with those settings uses
1,735 bytes. None meets the former 1,500-byte feed gate. Higher AVIF effort also
failed that gate at quality 75.

Production and fixture formats remain WebP at quality 75. The user approved a
3,500-byte feed image budget for the new full-width presentation. Image geometry,
source content, LCP and CLS limits are unchanged. See
[the recorded sizes](image-format-comparison.json) for the other candidate widths.
