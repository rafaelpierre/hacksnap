// Run from hacksnap/web with PLAYWRIGHT_MODULE pointing to an installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const base = process.env.BASE_URL || "http://localhost:3202/perf-image";
const configs = [
  { name: "mobile-1x", width: 360, height: 800, dpr: 1 },
  { name: "mobile-3x", width: 360, height: 800, dpr: 3 },
  { name: "desktop-1x", width: 1280, height: 900, dpr: 1 },
  { name: "desktop-2x", width: 1280, height: 900, dpr: 2 },
];
const cases = [
  { name: "10-card", count: 10 },
  { name: "30-card", count: 30 },
  { name: "detail", detail: 1 },
];
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const results = [];
  for (const fixture of cases)
    for (const config of configs)
      for (const mode of ["baseline", "optimized"]) {
        const context = await browser.newContext({
          viewport: { width: config.width, height: config.height },
          deviceScaleFactor: config.dpr,
        });
        const page = await context.newPage();
        const responses = [];
        page.on("response", async (response) => {
          if (response.request().resourceType() !== "image") return;
          try {
            const body = await response.body();
            responses.push({
              url: response.url(),
              status: response.status(),
              bytes: body.length,
              cache: response.headers()["x-nextjs-cache"] ?? null,
              contentType: response.headers()["content-type"] ?? null,
            });
          } catch (e) {
            responses.push({ url: response.url(), error: String(e) });
          }
        });
        await page.addInitScript(() => {
          window.__metrics = { lcp: null, cls: 0 };
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              window.__metrics.lcp = {
                startTime: e.startTime,
                size: e.size,
                tag: e.element?.tagName ?? null,
                className: typeof e.element?.className === "string" ? e.element.className : null,
                url: e.url ?? null,
              };
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              if (!e.hadRecentInput) window.__metrics.cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        const url = new URL(base);
        url.searchParams.set("mode", mode);
        if (fixture.detail) url.searchParams.set("detail", "1");
        else url.searchParams.set("count", fixture.count);
        const start = Date.now();
        await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 120000 });
        await page.waitForTimeout(400);
        const initial = await page.evaluate(() => ({
          metrics: window.__metrics,
          images: [...document.images].slice(0, 3).map((i) => ({
            currentSrc: i.currentSrc,
            srcset: i.srcset,
            sizes: i.sizes,
            loading: i.loading,
            fetchPriority: i.fetchPriority,
            box: i.getBoundingClientRect().toJSON(),
            naturalWidth: i.naturalWidth,
            naturalHeight: i.naturalHeight,
          })),
          viewport: { width: innerWidth, documentWidth: document.documentElement.scrollWidth },
        }));
        const initialImages = responses.length;
        const initialBytes = responses.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
        if (!fixture.detail) {
          const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y < scrollHeight; y += 550) {
            await page.evaluate((y) => window.scrollTo(0, y), y);
            await page.waitForTimeout(40);
          }
          await page.waitForLoadState("networkidle", { timeout: 120000 });
        }
        const final = await page.evaluate(() => window.__metrics);
        const record = {
          fixture: fixture.name,
          config: config.name,
          mode,
          elapsedMs: Date.now() - start,
          initial: { ...initial, imageRequests: initialImages, imageBytes: initialBytes },
          final: {
            metrics: final,
            imageRequests: responses.length,
            imageBytes: responses.reduce((sum, r) => sum + (r.bytes ?? 0), 0),
            responses,
          },
        };
        results.push(record);
        console.log(
          JSON.stringify({
            fixture: record.fixture,
            config: record.config,
            mode: record.mode,
            lcp: initial.metrics.lcp,
            cls: initial.metrics.cls,
            initialBytes,
            imageBytes: record.final.imageBytes,
            requests: record.final.imageRequests,
            firstSrc: initial.images[0]?.currentSrc,
          }),
        );
        await context.close();
      }
  await browser.close();
  const summary = results.map((record) => ({
    fixture: record.fixture,
    viewport: record.config,
    mode: record.mode,
    displayWidth: Math.round(record.initial.images[0].box.width),
    selectedWidth:
      Number(new URL(record.initial.images[0].currentSrc).searchParams.get("w")) || 1600,
    firstLoading: record.initial.images[0].loading,
    firstFetchPriority: record.initial.images[0].fetchPriority,
    initialImageRequests: record.initial.imageRequests,
    initialImageBytes: record.initial.imageBytes,
    totalImageRequests: record.final.imageRequests,
    totalImageBytes: record.final.imageBytes,
    lcpElement: record.initial.metrics.lcp?.tag ?? null,
    lcpMs: record.initial.metrics.lcp?.startTime ?? null,
    cls: record.initial.metrics.cls,
    documentWidth: record.initial.viewport.documentWidth,
  }));
  fs.writeFileSync(
    process.env.REPORT_PATH || "/private/tmp/issue142-summary.json",
    JSON.stringify(summary, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
