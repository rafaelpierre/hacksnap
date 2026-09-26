# Open Graph background

`og-grain.png` follows the canvas background on https://rafaelpierre.com/
(inspected 26 September 2026): one-pixel monochromatic noise of ±15 levels,
adapted to a dark charcoal base with neutral radial highlights and black shading.
The template adds a translucent `rgba(5, 5, 5, 0.2784)` dark overlay.

The texture is generated at the full 1200 × 630 card resolution, with a fixed
random seed so cached previews remain stable. It uses an indexed PNG to keep
the asset compact and requires no browser or external service at runtime.

Regenerate from the web directory with `node scripts/generate-og-background.mjs`
(using Sharp, provided by the installed Next.js dependencies).
