import { test, expect } from "./browser";

for (const width of [320, 1440]) {
  for (const textScale of [1, 2]) {
    test(`uniform feed cards at ${width}px and ${textScale * 100}% text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await page.evaluate(() => document.fonts.ready);
      const cards = page.locator(".feed-story");
      const styles = await cards.evaluateAll((nodes) =>
        nodes.slice(0, 3).map((node) => {
          const title = getComputedStyle(node.querySelector(".feed-story-title")!);
          const excerpt = getComputedStyle(node.querySelector(".feed-excerpt")!);
          const card = getComputedStyle(node);
          return [
            title.fontSize,
            title.fontWeight,
            title.lineHeight,
            title.letterSpacing,
            excerpt.fontSize,
            card.padding,
          ];
        }),
      );
      expect(styles).toHaveLength(3);
      expect(styles[0]).toEqual(styles[1]);
      expect(styles[0]).toEqual(styles[2]);
      for (let index = 0; index < 3; index++) {
        await expect(cards.nth(index).locator(".feed-discussion-preview")).toContainText(
          `Discussion fixture ${index + 1}:`,
        );
      }
      await cards.nth(1).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      await page.screenshot({ path: testInfo.outputPath(`cards-${width}-${textScale}.png`) });
    });
  }
}

test("a later card keeps its discussion through load more and reload", async ({ page }) => {
  await page.goto("/");
  await page.locator(".home-feed-continuation").scrollIntoViewIfNeeded();
  const later = page.locator('[data-home-story-id="91000020"]');
  await expect(later).toBeAttached();
  await later.scrollIntoViewIfNeeded();
  await expect(later.locator(".feed-discussion-preview")).toContainText("Discussion fixture 20:");
  await later.locator(".feed-story-title a").click();
  await expect(page).toHaveURL(/\/story\//);
  await page.goBack();
  await expect(later.locator(".feed-discussion-preview")).toContainText("Discussion fixture 20:");
  await page.reload();
  await expect(later.locator(".feed-discussion-preview")).toContainText("Discussion fixture 20:");
});
