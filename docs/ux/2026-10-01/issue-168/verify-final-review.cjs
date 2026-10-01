const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../../..");
const css = fs.readFileSync(path.join(root, "hacksnap/web/app/globals.css"), "utf8");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const evidenceDir = process.env.EVIDENCE_DIR || "/private/tmp/hacksnap-189-evidence";
fs.mkdirSync(evidenceDir, { recursive: true });

const card = (index, width, height) => `
  <article class="story-row feed-story" ${index === 0 ? 'id="first-card"' : ""}>
    <div class="story-domain story-context"><span>TOP STORY</span></div>
    <h3><a href="#story-${index}">A representative headline with enough words to wrap onto another line</a></h3>
    <div class="feed-story-image"><img width="${width}" height="${height}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'%3E%3Crect width='100%25' height='100%25' fill='%238899aa'/%3E%3C/svg%3E"></div>
    <div class="story-content"><p class="feed-excerpt">A readable synthetic excerpt that follows the headline and image in the shared feed card layout.</p>
      <div class="feed-story-footer"><span class="story-meta">12 points · 2 hours ago</span>
        <div class="share-menu"><button class="share-trigger">Share</button>${index === 0 ? `<div class="share-panel"><button id="panel-control-${index}" onclick="document.body.dataset.panelClicked='yes'">Copy link</button></div>` : ""}</div>
      </div>
    </div>
  </article>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [image, dimensions] of Object.entries({
      square: [900, 900],
      portrait: [1200, 1800],
      landscape: [1200, 675],
    })) {
      for (const width of [320, 1280])
        for (const theme of ["light", "dark"]) {
          const page = await browser.newPage({
            viewport: { width, height: 1100 },
            colorScheme: theme,
          });
          await page.setContent(
            `<html data-theme="${theme}" style="font-size:200%"><head><style>${css}</style></head><body><main>${card(0, ...dimensions)}${card(1, ...dimensions)}${card(2, ...dimensions)}</main></body></html>`,
          );
          const geometry = await page.locator("#first-card").evaluate((el) => {
            const rect = (node) => {
              const r = node.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                left: r.left,
                right: r.right,
                width: r.width,
                height: r.height,
              };
            };
            return {
              title: rect(el.querySelector(":scope > h3")),
              image: rect(el.querySelector(".feed-story-image img")),
              excerpt: rect(el.querySelector(".story-content .feed-excerpt")),
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.equal(geometry.overflow, false, `${image}/${width}/${theme} overflowed`);
          if (width === 320) {
            assert(
              geometry.title.bottom <= geometry.image.top + 1,
              `${image}/${width}/${theme}: title/image order`,
            );
            assert(
              geometry.image.bottom <= geometry.excerpt.top + 1,
              `${image}/${width}/${theme}: image/excerpt order`,
            );
          } else {
            assert(
              geometry.title.bottom <= geometry.image.top + 1,
              `${image}/${width}/${theme}: title above image`,
            );
            assert(
              geometry.excerpt.top <= geometry.image.top + 1,
              `${image}/${width}/${theme}: excerpt starts beside image`,
            );
            assert(
              geometry.excerpt.left >= geometry.image.right - 1,
              `${image}/${width}/${theme}: excerpt beside image`,
            );
            assert(
              geometry.image.top - geometry.title.bottom < 80,
              `${image}/${width}/${theme}: excess gap after title`,
            );
          }
          results.push({ image, width, theme, ...geometry });
          if (image === "portrait" && width === 1280 && theme === "light") {
            await page.addStyleTag({ content: ".share-panel { display: none !important; }" });
            await page.screenshot({
              path: path.join(evidenceDir, "portrait-desktop-light-200.png"),
              fullPage: true,
            });
          }
          await page.close();
        }
    }

    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    await page.setContent(
      `<html data-theme="light"><head><style>${css}</style></head><body><main>${card(0, 1200, 675)}${card(1, 1200, 675)}</main></body></html>`,
    );
    const panel = page.locator("#panel-control-0");
    await panel.focus();
    const hit = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const row = document.querySelector("#first-card");
      const rowRect = row.getBoundingClientRect();
      const nextRect = row.nextElementSibling.getBoundingClientRect();
      const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const hitY = r.top + r.height / 2;
      return {
        rowZIndex: getComputedStyle(row).zIndex,
        panelY: r.top,
        rowBottom: rowRect.bottom,
        nextTop: nextRect.top,
        hitY,
        overlapsNext: hitY >= nextRect.top && hitY < nextRect.bottom,
        targetIsControl: target === el,
      };
    });
    assert.equal(hit.rowZIndex, "2");
    assert(hit.overlapsNext, "share panel control must overlap the next card");
    assert.equal(hit.targetIsControl, true, "share panel control must receive pointer hit testing");
    await page.screenshot({
      path: path.join(evidenceDir, "share-panel-overlap.png"),
      fullPage: true,
    });
    await panel.click();
    assert.equal(await page.locator("body").getAttribute("data-panel-clicked"), "yes");
    results.push({ sharePanel: hit, clickable: true });
    await page.close();
    fs.writeFileSync(
      path.join(__dirname, "final-review-results.json"),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    console.log(JSON.stringify({ cases: results.length - 1, sharePanelClickable: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
