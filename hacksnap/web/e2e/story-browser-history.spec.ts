import { test, expect, title, storyPath } from "./browser";
import { packFeedSnapshot, validFeedPage, type FeedSnapshot } from "../lib/feed-state";
import { trackRequests } from "./request-idle";

test.describe("mobile browser history", () => {
  test.setTimeout(60_000);
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  for (const datedFeed of ["/2026/01", "/2026/01?page=2"]) {
    test(`dated breadcrumb restores ${datedFeed} after a related story and reload`, async ({
      page,
    }) => {
      const settleRequests = trackRequests(page);
      await page.goto(datedFeed);
      const card = page.locator(".story-list .feed-story-title a").nth(4);
      await card.scrollIntoViewIfNeeded();
      await settleRequests();
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(200);
      await card.tap();
      await page.waitForURL(/\/story\/[^?]+$/);
      await settleRequests();
      const related = page.getByRole("region", { name: "Related stories" }).locator("h3 a").first();
      await related.scrollIntoViewIfNeeded();
      await settleRequests();
      const nextHref = await related.getAttribute("href");
      await related.tap();
      await page.waitForURL((url) => url.pathname === nextHref && !url.search);
      await settleRequests();
      await page.reload();
      await settleRequests();
      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
      const back = breadcrumb.getByRole("link", {
        name: datedFeed.includes("?") ? "January 2026 archive · page 2" : "January 2026 archive",
        exact: true,
      });
      await expect(back).toHaveAttribute("href", datedFeed);
      await expect(breadcrumb.locator(".back-link")).toHaveCount(0);
      await back.scrollIntoViewIfNeeded();
      await settleRequests();
      await back.tap();
      await expect(page).toHaveURL((url) => url.pathname + url.search === datedFeed);
      await expect(card).toBeVisible();
      await expect
        .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - scrollY))
        .toBeLessThan(100);
      await settleRequests();
    });
  }
  for (const mode of ["direct", "redirect", "slow"]) {
    test(`first story navigation preserves the feed after arriving from another site (${mode})`, async ({
      page,
      context,
      baseURL,
      browserName,
    }) => {
      const settleRequests = trackRequests(page);
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
      // Scrolling starts viewport prefetches. Let those settle before the tap so
      // document unload does not turn an intercepted prefetch into a WebKit error.
      await card.scrollIntoViewIfNeeded();
      await settleRequests();
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
      // Only the first article load needs to outlive the tap. Do not repeat the
      // artificial delay in prefetches or Forward while checking the same entry.
      if (mode === "slow")
        await context.addCookies([{ name: "fixture-story", value: "direct", url: baseURL! }]);
      await settleRequests();
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/`);
      expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
      await expect(card).toBeVisible();
      await settleRequests();
      await page.goForward();
      await expect(page).toHaveURL(`${baseURL}${destination}`);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await settleRequests();
    });
  }

  test("reading another story preserves the original paginated topic return", async ({ page }) => {
    const settleRequests = trackRequests(page);
    await page.goto("/?category=models-products&page=2");
    const first = page.locator(".story-list .feed-story-title a").first();
    await first.scrollIntoViewIfNeeded();
    await settleRequests();
    await first.tap();
    await page.waitForURL(/\/story\/[^?]+$/);
    await settleRequests();
    const related = page.getByRole("region", { name: "Related stories" }).locator("h3 a").first();
    await related.scrollIntoViewIfNeeded();
    await settleRequests();
    const nextHref = await related.getAttribute("href");
    await related.tap();
    await page.waitForURL((url) => url.pathname === nextHref && !url.search);
    await settleRequests();
    const topicReturn = page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Models & Products", exact: true });
    await expect(topicReturn).toHaveAttribute("href", "/?category=models-products&page=2");
    await topicReturn.tap();
    await expect(page).toHaveURL(/category=models-products&page=2$/);
    await expect(page.locator(".story-list .feed-story-title a").first()).toBeVisible();
    await settleRequests();
  });

  for (const returnMode of ["browser Back", "explicit return"]) {
    test(`a Most read-only story preserves feed depth and scroll after ${returnMode} and reload`, async ({
      page,
      context,
      request,
      baseURL,
      browserName,
    }) => {
      const settleRequests = trackRequests(page);
      await context.addCookies([
        { name: "fixture-popularity", value: "outside-feed", url: baseURL! },
      ]);
      // Keep the rail in view beside the restored feed while exercising the link.
      await page.setViewportSize({ width: 1440, height: 1000 });
      const pages = await Promise.all(
        [1, 2].map(async (pageNumber) =>
          validFeedPage(
            await (await request.get(`/api/browse-stories?path=/&page=${pageNumber}`)).json(),
            "/",
          )!,
        ),
      );
      const snapshot: FeedSnapshot = {
        version: 1,
        url: "/",
        stories: pages.flatMap(({ stories }) => stories),
        pagination: pages[1].pagination,
        scrollY: 900,
        focusStoryId: null,
        savedAt: Date.now(),
      };
      await page.addInitScript(
        ({ snapshot, packed }) => {
          if (location.pathname !== "/" || sessionStorage.getItem("fixture-feed-seeded")) return;
          sessionStorage.setItem("fixture-feed-seeded", "true");
          window.name = "hacksnap-tab:most-read";
          const id = crypto.randomUUID();
          sessionStorage.setItem(`hacksnap:feed-snapshot:${id}`, packed);
          history.replaceState(
            {
              ...history.state,
              hacksnapHomeFeed: {
                version: 2,
                id,
                url: snapshot.url,
                scrollY: snapshot.scrollY,
                focusStoryId: null,
                savedAt: snapshot.savedAt,
                contentAt: snapshot.savedAt,
                storyCount: snapshot.stories.length,
                pagination: snapshot.pagination,
              },
            },
            "",
          );
        },
        { snapshot, packed: packFeedSnapshot(snapshot) },
      );
      const expectSavedFeed = async () => {
        await expect
          .poll(() =>
            page.evaluate(() => ({
              count: history.state?.hacksnapHomeFeed?.storyCount,
              page: history.state?.hacksnapHomeFeed?.pagination?.page,
              focus: history.state?.hacksnapHomeFeed?.focusStoryId,
            })),
          )
          .toEqual({ count: 30, page: 2, focus: null });
        await expect.poll(() => page.evaluate(() => Math.abs(scrollY - 900))).toBeLessThan(4);
      };
      await page.goto("/");
      await expectSavedFeed();
      const sidebarLink = page
        .getByRole("complementary", { name: "Most read" })
        .getByRole("link")
        .first();
      await expect(sidebarLink).toHaveAttribute("href", "/story/91000036");
      expect(snapshot.stories.some(({ hn_id }) => hn_id === "91000036")).toBe(false);
      await settleRequests();
      // Keyboard activation keeps the saved reading position while opening the sidebar link.
      await sidebarLink.evaluate((link) => link.focus({ preventScroll: true }));
      const documentRequest =
        browserName === "webkit"
          ? page.waitForRequest(
              (request) =>
                request.isNavigationRequest() &&
                new URL(request.url()).pathname === "/story/91000036",
            )
          : null;
      await page.keyboard.press("Enter");
      if (documentRequest) await documentRequest;
      await page.waitForURL(`${baseURL}/story/91000036`);
      await settleRequests();
      if (returnMode === "browser Back") await page.goBack();
      else {
        await page.reload();
        await settleRequests();
        await page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByRole("link", { name: "Latest", exact: true })
          .click();
      }
      await expect(page).toHaveURL(`${baseURL}/`);
      await expectSavedFeed();
      await settleRequests();
      // Reread persisted state in a fresh document instead of relying on a retained page.
      await page.reload();
      await expectSavedFeed();
      await settleRequests();
    });
  }
});
