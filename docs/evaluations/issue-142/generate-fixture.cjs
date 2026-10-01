// Run from hacksnap/web after npm ci. These files are temporary and must stay
// outside the committed web/public tree.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require(path.join(process.cwd(), "node_modules/sharp"));

const width = 1600;
const height = 900;
const data = Buffer.alloc(width * height * 3);
let seed = 142;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const offset = (y * width + x) * 3;
    const grain = seed >>> 26;
    data[offset] = Math.min(255, 40 + x / 10 + grain);
    data[offset + 1] = Math.min(255, 70 + y / 8 + grain);
    data[offset + 2] = Math.min(255, 85 + (x + y) / 15 + grain);
  }
}

(async () => {
  const encoded = await sharp(data, { raw: { width, height, channels: 3 } })
    .webp({ quality: 75 })
    .toBuffer();
  fs.mkdirSync("public", { recursive: true });
  for (let index = 0; index < 30; index++) {
    fs.writeFileSync(`public/fixture-image-${index}.webp`, encoded);
  }
  console.log(`Wrote 30 fixed ${width}×${height} WebP files (${encoded.byteLength} bytes each).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
