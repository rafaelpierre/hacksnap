import { test, expect } from "./browser";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import budgets from "./budgets.json";

type Rendering = { lcpMs: number; cls: number };
type AssetKind = "js" | "css" | "image" | "font";
for (const [route, budget] of Object.entries(budgets.routes)) {
  test(`cold route asset and rendering budget: ${route}`, async ({
    page,
    context,
    browser,
  }, testInfo) => {
    await context.addInitScript(() => {
      const values = { lcpMs: 0, cls: 0 };
      Object.defineProperty(window, "__browserRendering", { value: values });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) values.lcpMs = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      let windowStart = 0;
      let previousShift = 0;
      let windowValue = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (shift.hadRecentInput) continue;
          if (entry.startTime - previousShift > 1000 || entry.startTime - windowStart > 5000) {
            windowStart = entry.startTime;
            windowValue = 0;
          }
          windowValue += shift.value;
          previousShift = entry.startTime;
          values.cls = Math.max(values.cls, windowValue);
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const assets = new Map<string, { kind: AssetKind; bytes: number; gzip: number }>();
    const pending: Promise<void>[] = [];
    page.on("response", (response) => {
      const type = response.request().resourceType();
      if (
        !["script", "stylesheet", "image", "font"].includes(type) ||
        !response.url().startsWith("http://127.0.0.1:")
      )
        return;
      pending.push(
        (async () => {
          const body = await response.body();
          assets.set(response.url(), {
            kind:
              type === "script"
                ? "js"
                : type === "stylesheet"
                  ? "css"
                  : type === "font"
                    ? "font"
                    : "image",
            bytes: body.length,
            gzip: gzipSync(body, { level: 9 }).length,
          });
        })(),
      );
    });
    const response = await page.goto(route, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("main img").first()).toBeVisible();
    await page.waitForTimeout(500); // Fixed observation window after all initial assets finish.
    await Promise.all(pending);
    const inlineCSS = await page.locator("style").allTextContents();
    const sum = (kind: AssetKind, field: "bytes" | "gzip") =>
      [...assets.values()]
        .filter((asset) => asset.kind === kind)
        .reduce((total, asset) => total + asset[field], 0);
    const rendering = await page.evaluate(
      () => (window as unknown as { __browserRendering: Rendering }).__browserRendering,
    );
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { responseStartMs: entry.responseStart, fcpMs: fcp?.startTime ?? null };
    });
    const measurements = {
      jsBytes: sum("js", "bytes"),
      cssBytes: sum("css", "bytes") + inlineCSS.reduce((n, css) => n + Buffer.byteLength(css), 0),
      imageBytes: sum("image", "bytes"),
      fontBytes: sum("font", "bytes"),
      fontRequests: [...assets.values()].filter((asset) => asset.kind === "font").length,
      jsGzipBytes: sum("js", "gzip"),
      cssGzipBytes:
        sum("css", "gzip") +
        inlineCSS.reduce((n, css) => n + gzipSync(css, { level: 9 }).length, 0),
      ...rendering,
      ...navigation,
    };
    const report = testInfo.outputPath("performance.json");
    await writeFile(
      report,
      JSON.stringify(
        {
          route,
          browser: browser.version(),
          measurements,
          budget,
          documentBytes: (await response!.body()).length,
          assets: [...assets],
        },
        null,
        2,
      ),
    );
    await testInfo.attach("performance.json", { contentType: "application/json", path: report });
    expect(measurements.jsBytes).toBeGreaterThan(0);
    expect(measurements.cssBytes).toBeGreaterThan(0);
    expect(measurements.imageBytes).toBeGreaterThan(0);
    expect(measurements.fontBytes).toBeGreaterThan(0);
    expect(measurements.fontRequests).toBeGreaterThan(0);
    expect(measurements.lcpMs).toBeGreaterThan(0);
    for (const key of Object.keys(budget) as (keyof typeof budget)[])
      expect(measurements[key], `${route} ${key}`).toBeLessThanOrEqual(budget[key]);
  });
}
