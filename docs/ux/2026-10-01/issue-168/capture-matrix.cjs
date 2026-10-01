const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.BASE_URL || "http://127.0.0.1:3196";
const output = process.env.EVIDENCE_DIR || "/private/tmp/hacksnap-168-evidence/run";
const captureOnly = process.env.CAPTURE_ONLY === "1";
const themes = captureOnly ? ["light"] : ["light", "dark"];
const zoomLevels = captureOnly ? [200] : [100, 200];
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#d99b51"/></svg>',
);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = [];
  for (const [route, pathname] of [
    ["top", "/"],
    ["latest", "/archive"],
    ["topic", "/category/agents-coding"],
  ]) {
    for (const width of [320, 1280]) {
      for (const theme of themes) {
        for (const zoom of zoomLevels) {
          const page = await browser.newPage({
            viewport: { width, height: 900 },
            colorScheme: theme,
          });
          await page.addInitScript((value) => localStorage.setItem("hacksnap-theme", value), theme);
          await page.route("https://store.public.blob.vercel-storage.com/**", (request) =>
            request.fulfill({ status: 200, contentType: "image/svg+xml", body: svg }),
          );
          await page.goto(`${base}${pathname}`, { waitUntil: "domcontentloaded" });
          const card = page.locator(".story-row").first();
          await card.waitFor();
          await page.evaluate((value) => {
            document.documentElement.style.fontSize = `${value}%`;
          }, zoom);
          const measurement = await page.evaluate(() => {
            const article = document.querySelector(".story-row");
            const box = (selector) => {
              const rect = article.querySelector(selector).getBoundingClientRect();
              return {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                right: Math.round(rect.right),
                bottom: Math.round(rect.bottom),
              };
            };
            const image = article.querySelector(".feed-story-image img");
            return {
              viewport: innerWidth,
              document: document.documentElement.scrollWidth,
              title: box("h3"),
              image: {
                ...box(".feed-story-image img"),
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
              },
              excerpt: box(".feed-excerpt"),
              footer: box(".feed-story-footer"),
            };
          });
          const overlaps = (left, right) =>
            left.x < right.right &&
            right.x < left.right &&
            left.y < right.bottom &&
            right.y < left.bottom;
          if (
            measurement.document > width ||
            measurement.image.naturalWidth !== 1200 ||
            measurement.image.naturalHeight !== 675 ||
            overlaps(measurement.title, measurement.image) ||
            overlaps(measurement.image, measurement.excerpt) ||
            overlaps(measurement.title, measurement.excerpt) ||
            measurement.footer.y < measurement.excerpt.bottom
          ) {
            throw new Error(`${route}/${width}/${theme}/${zoom}: ${JSON.stringify(measurement)}`);
          }
          if (
            width === 320 &&
            !(
              measurement.title.y < measurement.image.y &&
              measurement.image.bottom <= measurement.excerpt.y
            )
          ) {
            throw new Error(
              `Mobile reading order ${route}/${theme}/${zoom}: ${JSON.stringify(measurement)}`,
            );
          }
          if (zoom === 200 && theme === "light") {
            await page.addStyleTag({
              content: ".site-header, nextjs-portal { display: none !important; }",
            });
            await card.screenshot({
              path: path.join(output, `${route}-${width}-${theme}-${zoom}.png`),
              animations: "disabled",
            });
          }
          report.push({ route, width, theme, zoom, ...measurement });
          await page.close();
        }
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log(`passed ${report.length} card-layout checks`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
