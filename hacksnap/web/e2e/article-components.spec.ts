import { test, expect, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 375, 768, 1280]) {
  for (const textSize of [100, 200]) {
    test(`article components follow the reading system at ${width}px with ${textSize}% text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(storyPath);
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, textSize);
      const metadata = page.locator(".story-header .story-context");
      await expect(metadata.locator(".category-badge")).toHaveText("Models & Products");
      await expect(metadata.locator("time.story-age")).toHaveText(/^(<1h|\d+h|\d+d(?: \d+h)?)$/);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
      await expect(metadata.locator("details, summary, .story-age-exact")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("article-header.png") });

      const brief = page.locator("#article-brief");
      await expect(brief.locator("p br")).toHaveCount(1);
      await brief.screenshot({ path: testInfo.outputPath("article-brief.png") });

      const theme = page.locator(".analysis-theme-details").first();
      const summary = theme.locator("summary");
      await expect(theme.getByRole("button", { name: /Source comments for/ })).not.toBeVisible();
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(theme).toHaveAttribute("open", "");
      await expect(summary).toHaveCSS("background-color", "rgb(238, 238, 255)");
      await expect(theme.getByRole("button", { name: /Source comments for/ })).toBeVisible();
      await summary.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("discussion-open.png") });
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await summary.press("Space");
      await expect(theme).not.toHaveAttribute("open", "");

      const card = page.locator(".related-story-list article").first();
      await expect(card.locator(".feed-excerpt")).not.toBeEmpty();
      const link = card.getByRole("link");
      const destination = await link.getAttribute("href");
      await link.focus();
      await expect(card).toHaveCSS("outline-style", "solid");
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("recommendations.png") });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      // Clicking the card padding exercises the extended destination, not just its headline.
      await card.click({ position: { x: 10, y: 10 } });
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    });
  }
}
