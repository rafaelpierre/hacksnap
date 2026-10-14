import { test, expect } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1280]) {
  for (const textSize of [100, 200]) {
    test(`structured summaries at ${width}px and ${textSize}% text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/story/91000039");
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, textSize);
      const brief = page.locator("#article-brief");
      await expect(
        brief.getByRole("heading", { level: 2, name: "Repeatable measurements" }),
      ).toBeVisible();
      await expect(
        brief.getByRole("heading", { level: 3, name: "Reliability limits" }),
      ).toBeVisible();
      await expect(brief.locator("strong")).toHaveText([
        "small models",
        "a fixed task set",
        "repeatable tasks",
      ]);
      const source = brief.getByRole("link");
      await expect(source).toHaveAttribute("href", "https://example.com/research");
      await source.focus();
      await expect(source).toHaveCSS("outline-style", "solid");
      const theme = page.locator(".analysis-theme-details").first();
      await theme.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(theme.locator("strong")).toHaveText("Repeatable measurements");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await brief.screenshot({ path: testInfo.outputPath("structured-summary.png") });
    });
  }
}

test.describe("structured summaries without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("headings, emphasis and disclosure content are server rendered", async ({ page }) => {
    await page.goto("/story/91000039");
    await expect(page.getByRole("heading", { level: 3, name: "Reliability limits" })).toBeVisible();
    await expect(page.locator("#article-brief strong")).toHaveCount(3);
    const theme = page.locator(".analysis-theme-details").first();
    await theme.locator("summary").click();
    await expect(theme.locator("strong")).toBeVisible();
  });
});
