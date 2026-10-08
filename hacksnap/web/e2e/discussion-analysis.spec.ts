import { test, expect, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1280])
  for (const textScale of [1, 2]) {
    test(`analysis information: ${width}px ${textScale * 100}% text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(storyPath);
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await page
        .getByRole("navigation", { name: "Story sections" })
        .getByRole("link", { name: "Discussion analysis" })
        .click();
      await expect(page.locator("#discussion-analysis")).toBeFocused();
      await expect(
        page.getByRole("heading", { name: "Discussion analysis", exact: true }),
      ).toBeVisible();
      const headingBounds = await page
        .getByRole("heading", { name: "Discussion analysis", exact: true })
        .boundingBox();
      expect(headingBounds!.width).toBeGreaterThanOrEqual(140);
      expect(headingBounds!.height).toBeLessThan(320);
      const trigger = page.getByRole("button", { name: "About this discussion analysis" });
      const popup = page.getByRole("dialog", { name: "Analysis details" });
      await trigger.scrollIntoViewIfNeeded();
      await expect(page.locator(".analysis-coverage")).not.toBeVisible();
      await expect(page.getByRole("link", { name: /Read the full HN discussion/ })).toHaveCount(0);
      const target = await trigger.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath("analysis-closed.png") });
      await trigger.click();
      await expect(popup).toBeVisible();
      await expect(popup).toContainText("12 comments analyzed.");
      await expect(popup).toContainText("12 of 30 usable stored comments");
      await expect(page.getByRole("button", { name: "Close analysis information" })).toBeFocused();
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("analysis-open.png") });
      await page.keyboard.press("Escape");
      await expect(popup).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(popup).toBeVisible();
      await page.getByRole("button", { name: "Close analysis information" }).click();
      await expect(popup).not.toBeVisible();
      await trigger.click();
      await page.mouse.click(1, bounds!.y + 10);
      await expect(popup).not.toBeVisible();
      await page.getByRole("button", { name: "Source comments for Measuring useful work" }).click();
      await expect(
        page.getByRole("dialog", { name: "Source comments", exact: true }),
      ).toBeVisible();
      await expect(popup).not.toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    });
  }

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("analysis information disclosure still opens and closes", async ({ page }) => {
    await page.goto(storyPath);
    const popup = page.getByRole("dialog", { name: "Analysis details" });
    await expect(page.locator(".analysis-coverage")).not.toBeVisible();
    await page.getByRole("button", { name: "About this discussion analysis" }).click();
    await expect(popup).toBeVisible();
    await page.getByRole("button", { name: "Close analysis information" }).click();
    await expect(popup).not.toBeVisible();
  });
});
