const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = "http://127.0.0.1:3178";
const out = "/private/tmp/178-browser-evidence";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = { matrix: [], navigation: [], errors: [] };
  try {
    for (const width of [320, 1280])
      for (const theme of ["light", "dark"])
        for (const zoom of [100, 200]) {
          const page = await browser.newPage({
            viewport: { width, height: 900 },
            colorScheme: theme,
            reducedMotion: "reduce",
          });
          page.on("pageerror", (error) => report.errors.push(error.message));
          await page.addInitScript(({ theme }) => localStorage.setItem("hacksnap-theme", theme), {
            theme,
          });
          for (const [name, path] of [
            ["top", "/"],
            ["latest", "/archive"],
            ["category", "/category/agents-coding"],
          ]) {
            await page.goto(base + (name === "category" ? "/topics" : "/about"));
            await page.evaluate(
              (zoom) => (document.documentElement.style.fontSize = zoom + "%"),
              zoom,
            );
            const start = Date.now();
            await page
              .locator(
                name === "category"
                  ? '.topic-directory a[href="' + path + '"]'
                  : '.main-navigation a[href="' + path + '"]',
              )
              .click();
            await page.getByText("Loading stories…", { exact: true }).waitFor();
            await page.evaluate(
              (zoom) => (document.documentElement.style.fontSize = zoom + "%"),
              zoom,
            );
            const skeletonMs = Date.now() - start;
            const geometry = await page.evaluate(() => ({
              width: innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              focusableSkeleton: document.querySelectorAll(
                'ol[aria-hidden="true"] a,ol[aria-hidden="true"] button',
              ).length,
              animations: [...document.querySelectorAll('ol[aria-hidden="true"] span')].map(
                (x) => getComputedStyle(x).animationName,
              ),
            }));
            assert(
              geometry.scrollWidth <= width,
              `${name} ${width} ${theme} ${zoom} overflow ${geometry.scrollWidth}`,
            );
            assert.equal(geometry.focusableSkeleton, 0);
            assert(geometry.animations.every((a) => a === "none"));
            await page.screenshot({
              path: `${out}/${name}-${width}-${theme}-${zoom}.png`,
              fullPage: zoom === 200,
            });
            await page.locator(".story-row h3 a").first().waitFor();
            assert.equal(await page.getByText("Loading stories…", { exact: true }).count(), 0);
            assert.equal(await page.locator(".story-row h3 a").count(), 5);
            report.matrix.push({
              name,
              width,
              theme,
              textPercent: zoom,
              skeletonMs,
              storiesMs: Date.now() - start,
              ...geometry,
            });
          }
          await page.close();
        }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.goto(base + "/archive");
    await page.locator(".story-row h3 a").first().waitFor();
    for (const [name, path, selector] of [
      ["top", "/", '.main-navigation a[href="/"]'],
      [
        "category",
        "/category/research-evaluation",
        '.topic-sidebar a[href="/category/research-evaluation"]',
      ],
      ["latest", "/archive", '.main-navigation a[href="/archive"]'],
    ]) {
      const start = Date.now();
      await page.locator(selector).click();
      await page.getByText("Loading stories…", { exact: true }).waitFor();
      const skeletonMs = Date.now() - start;
      await page.locator(".story-row h3 a").first().waitFor();
      assert.equal(new URL(page.url()).pathname, path);
      assert.equal(await page.locator('[data-pending="true"]').count(), 0);
      report.navigation.push({ name, skeletonMs, storiesMs: Date.now() - start });
    }
    await page.goBack();
    await page.waitForURL(base + "/category/research-evaluation");
    await page.locator(".story-row h3 a").first().waitFor();
    await page.goForward();
    await page.waitForURL(base + "/archive");
    await page.locator(".story-row h3 a").first().waitFor();
    report.backForward = "passed";
    // Hold navigation response to observe immediate pending UI before server shell.
    let release;
    const gate = new Promise((r) => (release = r));
    await page.route("**/category/safety-privacy?*", async (route) => {
      await gate;
      await route.continue();
    });
    const link = page.locator('.topic-sidebar a[href="/category/safety-privacy"]');
    await link.click();
    await link.locator('[data-pending="true"]').waitFor();
    report.pendingBeforeResponse = true;
    await page.screenshot({ path: out + "/pending-link.png" });
    release();
    await page.waitForURL(base + "/category/safety-privacy");
    await page.locator(".story-row h3 a").first().waitFor();
    assert.equal(await page.locator('[data-pending="true"]').count(), 0);
    // Route syntax checks must return HTTP 404 even with streaming skeletons.
    report.invalidRoutes = [];
    for (const path of [
      "/not-a-route",
      "/?page=0",
      "/category/not-a-category",
      "/category/agents-coding?page=101",
      "/archive/2026/13",
      "/archive?page=0",
      "/archive/2025/01",
    ]) {
      const response = await page.request.get(base + path);
      assert.equal(response.status(), 404, path);
      report.invalidRoutes.push({ path, status: response.status() });
    }
    await page.close();
    const nojs = await browser.newPage({ javaScriptEnabled: false });
    report.noJavaScript = [];
    for (const path of ["/", "/archive", "/category/agents-coding"]) {
      await nojs.goto(base + path);
      assert.equal(await nojs.locator(".story-row h3 a:visible").count(), 5);
      assert.equal(await nojs.getByText("Loading stories…", { exact: true }).count(), 0);
      report.noJavaScript.push({ path, visibleStories: 5 });
    }
    await nojs.close();
    assert.deepEqual(report.errors, []);
  } finally {
    fs.writeFileSync(out + "/results.json", JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
