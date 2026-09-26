import sharp from "sharp";

// Match the fine grain at https://rafaelpierre.com/ (26 September 2026),
// with neutral charcoal tones in place of the reference’s colored gradients.
// Generate at output resolution so grain stays crisp rather than being enlarged.
const width = 1200;
const height = 630;
const pixels = Buffer.alloc(width * height * 3);
const gradients = [
  [0.15, 0.94, 0.72, [101, 101, 101], 0.24],
  [0.82, 0.19, 0.64, [214, 214, 214], 0.19],
  [0.44, 0.63, 0.58, [93, 93, 93], 0.18],
  [0.06, 0.13, 0.62, [0, 0, 0], 0.41],
  [0.94, 0.91, 0.68, [0, 0, 0], 0.46],
];
let seed = 20260926;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const color = [24, 24, 24];
    for (const [cx, cy, radius, tint, opacity] of gradients) {
      const distance = Math.hypot(x - cx * width, y - cy * height) / (radius * Math.max(width, height));
      const falloff = distance < 0.5 ? 1 - distance * 1.28 : Math.max(0, (1 - distance) * 0.72);
      const alpha = opacity * falloff;
      for (let channel = 0; channel < 3; channel++) {
        color[channel] = color[channel] * (1 - alpha) + tint[channel] * alpha;
      }
    }
    // Same +/-15 luminance grain as the reference, seeded for stable previews.
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296 - 0.5) * 30;
    for (let channel = 0; channel < 3; channel++) {
      pixels[(y * width + x) * 3 + channel] = Math.round(Math.max(0, Math.min(255, color[channel] + noise)));
    }
  }
}
await sharp(pixels, {raw: {width, height, channels: 3}})
  .png({palette: true, colours: 256, dither: 0})
  .toFile(new URL("../lib/assets/og-grain.png", import.meta.url).pathname);
