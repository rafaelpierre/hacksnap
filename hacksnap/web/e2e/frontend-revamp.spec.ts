import type { Page } from "@playwright/test";
import { test, expect } from "./browser";

const widths = [320, 375, 414, 768, 959, 961, 1024, 1247, 1249, 1440];
const variants = {
  wide: { width: 1600, height: 900, label: "Wide image fixture" },
  diagram: { width: 1200, height: 700, label: "Diagram fixture" },
  portrait: { width: 800, height: 1400, label: "Portrait artwork fixture" },
};

/** Deliberately labeled geometry fixtures, not publisher photography. */
async function imageFixtures(page: Page, failedResponse?: Promise<void>) {
  await page.route("**/_next/image?**", async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get("url") ?? "";
    if (!source.includes("frontend-fixture-")) return route.fallback();
    if (source.includes("-failed.webp")) {
      if (failedResponse) await failedResponse;
      return route.fulfill({ contentType: "image/webp", body: "invalid image fixture" });
    }
    const name = Object.keys(variants).find((key) => source.endsWith(`-${key}.webp`));
    if (!name) throw new Error(`Unknown media fixture ${source}`);
    const variant = variants[name as keyof typeof variants];
    const outputWidth = Number(url.searchParams.get("w"));
    const outputHeight = Math.round((outputWidth * variant.height) / variant.width);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${variant.width} ${variant.height}"><rect width="100%" height="100%" fill="#edf0f8"/><rect x="20" y="20" width="${variant.width - 40}" height="${variant.height - 40}" rx="12" fill="none" stroke="#0000ff" stroke-width="12"/><text x="60" y="100" font-family="sans-serif" font-size="44" fill="#24242b">${variant.label}</text><rect x="60" y="150" width="${variant.width - 120}" height="100" fill="#fff" stroke="#85858f" stroke-width="3"/><path d="M80 310 H${variant.width - 80} M80 390 H${variant.width - 80}" stroke="#62626e" stroke-width="16"/><circle cx="${variant.width / 2}" cy="${variant.height - 160}" r="90" fill="#0000ff"/></svg>`;
    await route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
}

for (const width of widths) {
  test(`frontend layout and media evidence at ${width}px`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await context.addCookies([{ name: "fixture-images", value: "varied", url: baseURL! }]);
    await imageFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const first = page.locator('[data-home-story-id="91000001"]');
    await expect(first.locator("article")).toHaveClass(/feed-story-lead/);
    await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(1);
    await expect(first.locator("img")).toHaveAttribute("fetchpriority", "high");
    await page.screenshot({
      path: testInfo.outputPath(`feed-${width}.png`),
      animations: "disabled",
    });
    for (const [index, name] of ["wide", "diagram", "portrait"].entries()) {
      const row = page.locator(`[data-home-story-id="${91000001 + index}"]`);
      const image = row.locator(".feed-story-image img");
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
        .toBeGreaterThan(0);
      const geometry = await image.evaluate((node: HTMLImageElement) => {
        const rect = node.getBoundingClientRect();
        const card = node.closest("article")!;
        const cardRect = card.getBoundingClientRect();
        const css = getComputedStyle(card);
        return {
          width: rect.width,
          height: rect.height,
          left: rect.x - cardRect.x,
          right: cardRect.right - rect.right,
          padding: parseFloat(css.paddingLeft),
          border: parseFloat(css.borderLeftWidth),
          fit: getComputedStyle(node).objectFit,
        };
      });
      const variant = variants[name as keyof typeof variants];
      expect(geometry.width / geometry.height).toBeCloseTo(variant.width / variant.height, 2);
      expect(geometry.border).toBe(width < 672 ? 0 : 1);
      expect(geometry.left).toBeCloseTo(geometry.padding + geometry.border, 0);
      expect(geometry.right).toBeCloseTo(geometry.padding + geometry.border, 0);
      expect(geometry.fit).not.toBe("cover");
      if (index > 0) await expect(image).toHaveAttribute("loading", "lazy");
      await testInfo.attach(`${name}-${width}-selected-image.json`, {
        contentType: "application/json",
        body: JSON.stringify(
          await image.evaluate((node: HTMLImageElement) => ({
            candidate: node.currentSrc,
            renderedWidth: node.getBoundingClientRect().width,
            naturalWidth: node.naturalWidth,
            devicePixelRatio: window.devicePixelRatio,
          })),
          null,
          2,
        ),
      });
      await row.screenshot({
        path: testInfo.outputPath(`${name}-${width}.png`),
        animations: "disabled",
      });
    }
    const missing = page.locator('[data-home-story-id="91000004"]');
    await missing.scrollIntoViewIfNeeded();
    await expect(missing.locator(".feed-story-image")).toHaveCount(0);
    await missing.screenshot({ path: testInfo.outputPath(`missing-${width}.png`) });
    const failed = page.locator('[data-home-story-id="91000005"]');
    await failed.scrollIntoViewIfNeeded();
    await expect(failed.locator(".feed-story-image")).toHaveCount(0);
    await failed.screenshot({ path: testInfo.outputPath(`failed-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
  });
}

test("image decode failure removes the image wrapper", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "fixture-images", value: "varied", url: baseURL! }]);
  let failImage!: () => void;
  const response = new Promise<void>((resolve) => {
    failImage = resolve;
  });
  await imageFixtures(page, response);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-home-story-id="91000005"]');
  await row.scrollIntoViewIfNeeded();
  const media = row.locator(".feed-story-image");
  await expect(media).toBeVisible();
  failImage();
  await expect(media).toHaveCount(0);
});

for (const width of [320, 1440]) {
  test(`small original image is hidden without a placeholder at ${width}px`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await context.addCookies([{ name: "fixture-images", value: "varied", url: baseURL! }]);
    await imageFixtures(page);
    let finish!: () => void;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route("https://*.public.blob.vercel-storage.com/**", async (route) => {
      if (!route.request().url().includes("frontend-fixture-wide")) return route.fallback();
      expect(route.request().method()).toBe("HEAD");
      await response;
      await route.fulfill({
        headers: { "access-control-allow-origin": "*", "content-length": "1428" },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.locator('[data-home-story-id="91000001"]');
    await expect(row.locator("img")).toBeVisible();
    finish();
    await expect(row.locator(".feed-story-image")).toHaveCount(0);
    await expect(row.locator(".article-image-unavailable")).toHaveCount(0);
    await expect(page.locator('[data-home-story-id="91000002"] img')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
    await row.screenshot({ path: testInfo.outputPath(`hidden-small-image-${width}.png`) });
  });
}

test("appending and windowing never promote a later card to lead", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".feed-story-lead")).toHaveCount(1);
  await page.locator(".home-feed-continuation").scrollIntoViewIfNeeded();
  const later = page.locator('[data-home-story-id="91000020"]');
  await later.scrollIntoViewIfNeeded();
  await expect(later.locator("article")).not.toHaveClass(/feed-story-lead/);
  const leads = await page
    .locator(".feed-story-lead")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.closest("[data-home-story-id]")?.getAttribute("data-home-story-id")),
    );
  expect(leads.every((id) => id === "91000001")).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('[data-home-story-id="91000001"] .feed-story-lead')).toBeVisible();
});

test.describe("high density mobile media", () => {
  test.use({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
  test("the first available image gets priority when the lead has no media", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await context.addCookies([
      { name: "fixture-images", value: "varied", url: baseURL! },
      { name: "fixture-lead", value: "no-image", url: baseURL! },
    ]);
    await imageFixtures(page);
    await page.goto("/");
    const lead = page.locator('[data-home-story-id="91000001"]');
    await expect(lead.locator("article")).toHaveClass(/feed-story-lead/);
    await expect(lead.locator("img")).toHaveCount(0);
    const image = page.locator('[data-home-story-id="91000002"] img');
    await expect(image).toHaveAttribute("fetchpriority", "high");
    await expect(image).toHaveAttribute("loading", "eager");
    await image.scrollIntoViewIfNeeded();
    const selected = await image.evaluate((node: HTMLImageElement) => ({
      candidate: node.currentSrc,
      width: node.getBoundingClientRect().width,
      ratio: window.devicePixelRatio,
    }));
    expect(selected.ratio).toBe(2);
    expect(Number(new URL(selected.candidate).searchParams.get("w"))).toBeGreaterThanOrEqual(
      selected.width * selected.ratio,
    );
    await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(1);
    await testInfo.attach("dpr2-selected-image.json", {
      contentType: "application/json",
      body: JSON.stringify(selected, null, 2),
    });
    await page.screenshot({ path: testInfo.outputPath("image-414-dpr2.png") });
  });
});
