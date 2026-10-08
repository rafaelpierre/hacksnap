import { test, expect, title, storyPath } from "./browser";

test.describe("mobile browser history", () => {
  test.setTimeout(60_000);
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  for (const mode of ["direct", "redirect", "slow"]) {
    test(`first story navigation preserves the feed after arriving from another site (${mode})`, async ({
      page,
      context,
      baseURL,
      browserName,
    }) => {
      await context.addCookies([{ name: "fixture-story", value: mode, url: baseURL! }]);
      const destination = mode === "redirect" ? "/story/canonical-story-91000001" : storyPath;
      await page.route("https://previous.example/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<meta name="viewport" content="width=device-width, initial-scale=1"><a href="${baseURL}/">Visit Hacksnap</a>`,
        }),
      );
      await page.goto("https://previous.example/");
      await page.getByRole("link", { name: "Visit Hacksnap" }).tap();
      const card = page.locator(".story-list").getByRole("link", { name: title, exact: true });
      await expect(card).toBeVisible();
      await page.waitForLoadState("networkidle");
      const historyLength = await page.evaluate(() => history.length);
      const documentRequest =
        browserName === "webkit"
          ? page.waitForRequest(
              (request) =>
                request.isNavigationRequest() && new URL(request.url()).pathname === storyPath,
            )
          : null;
      await card.tap();
      // Require native document navigation on iOS, even when the response is delayed.
      // Playwright goBack alone does not emulate every browser toolbar history policy.
      if (documentRequest) await documentRequest;
      await page.waitForURL(`${baseURL}${destination}`, { timeout: 20_000 });
      await page.waitForLoadState("networkidle");
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/`);
      expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
      await expect(card).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.goForward();
      await expect(page).toHaveURL(`${baseURL}${destination}`);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    });
  }

  test("reading another story preserves the original paginated topic return", async ({ page }) => {
    await page.goto("/?category=models-products&page=2");
    await page.waitForLoadState("networkidle");
    await page.locator(".story-list h3 a").first().tap();
    await page.waitForURL(/\/story\/[^?]+$/);
    await page.waitForLoadState("networkidle");
    const related = page.getByRole("region", { name: "Read next" }).locator("h3 a").first();
    const nextHref = await related.getAttribute("href");
    await related.tap();
    await page.waitForURL((url) => url.pathname === nextHref && !url.search);
    await page.waitForLoadState("networkidle");
    const topicReturn = page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Models & Products", exact: true });
    await expect(topicReturn).toHaveAttribute("href", "/?category=models-products&page=2");
    await topicReturn.tap();
    await expect(page).toHaveURL(/category=models-products&page=2$/);
    await expect(page.locator(".story-list h3 a").first()).toBeVisible();
  });
});
