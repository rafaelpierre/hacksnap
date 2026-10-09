import { test, expect } from "./browser";

for (const width of [320, 1440]) {
  for (const textScale of [1, 2]) {
    test(`articles without publisher images at ${width}px and ${textScale * 100}% text`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      await context.addCookies([{ name: "fixture-images", value: "varied", url: baseURL! }]);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      const row = page.locator('[data-home-story-id="91000004"]');
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator(".feed-story-image")).toHaveCount(0);
      await expect(row.locator(".feed-excerpt")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      await row.screenshot({
        path: testInfo.outputPath(`feed-no-image-${width}-${textScale}.png`),
      });
      const link = row.locator(".feed-story-title a");
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/story\/.*91000004/);
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(".story-article-image")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      await page.screenshot({
        path: testInfo.outputPath(`story-no-image-${width}-${textScale}.png`),
      });
      await page.goBack();
      await expect(row).toBeVisible();
      await expect(row.locator(".feed-story-image")).toHaveCount(0);
    });
  }
}
