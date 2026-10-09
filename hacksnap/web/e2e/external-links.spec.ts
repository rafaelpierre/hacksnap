import { test, expect, storyPath, title } from "./browser";
import type { Locator, Page } from "@playwright/test";

async function opensNewTab(page: Page, link: Locator, keyboard = false) {
  const originalURL = page.url();
  const href = await link.getAttribute("href");
  const popupPromise = page.waitForEvent("popup");
  if (keyboard) {
    await link.focus();
    await page.keyboard.press("Enter");
  } else await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(href);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(page).toHaveURL(originalURL);
  await popup.close();
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(`external links with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, () => {
    test.use({ javaScriptEnabled });

    test("comments, articles and citations keep the reader open", async ({ page, context }) => {
      await context.route(/^https:\/\/(news\.ycombinator\.com|example\.com)\//, (route) =>
        route.fulfill({ contentType: "text/html", body: "<p>External destination</p>" }),
      );
      await page.goto("/");
      await opensNewTab(page, page.locator(".feed-comments").first());
      await page.getByRole("link", { name: title, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
      await opensNewTab(page, page.locator(".article-brief-sentence a"), true);
      await page
        .locator(".analysis-theme-details > summary")
        .filter({ hasText: "Measuring useful work" })
        .click();
      await page.getByRole("button", { name: "Source comments for Measuring useful work" }).click();
      await opensNewTab(page, page.locator(".analysis-source-popup:popover-open a").first());
      await page.goBack();
      await expect(page).toHaveURL("/");
    });
  });
}
