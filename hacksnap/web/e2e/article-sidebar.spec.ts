import { test, expect, title, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

test("fresh direct article visit and reload include the sidebar in the document", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(new URL(request.url()).pathname);
  });
  for (const visit of [() => page.goto(storyPath), () => page.reload()]) {
    const response = await visit();
    expect(response!.status()).toBe(200);
    expect(await response!.text()).toContain('class="browse-right-sidebar"');
    const sidebar = page.getByRole("complementary", { name: "Most read" });
    await expect(sidebar).toBeInViewport();
    await expect(sidebar.getByRole("link")).toHaveCount(5);
  }
  expect(documents).toEqual([storyPath, storyPath]);
});

test("direct canonical redirect retains the shared sidebar", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "fixture-story", value: "redirect", url: baseURL! }]);
  await page.goto(storyPath);
  await expect(page).toHaveURL(/\/story\/canonical-story-91000001/);
  await expect(
    page.getByRole("complementary", { name: "Most read" }).getByRole("link"),
  ).toHaveCount(5);
});

test("sidebar stays mounted when navigating away from a directly opened article", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(storyPath);
  const sidebar = page.getByRole("complementary", { name: "Most read" });
  await expect(sidebar.getByRole("link")).toHaveCount(5);
  await sidebar.evaluate((node) => node.setAttribute("data-persistence-probe", "original"));
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "About", exact: true })
    .click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(sidebar).toHaveAttribute("data-persistence-probe", "original");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(storyPath));
  await expect(sidebar).toHaveAttribute("data-persistence-probe", "original");
});

for (const id of ["91999999", "99999999"])
  test(`direct unavailable or missing story ${id} keeps Most read`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: id === "99999999" });
    try {
      const page = await context.newPage();
      const response = await page.goto(`${baseURL}/story/${id}`);
      expect(response!.status()).toBe(id === "99999999" ? 404 : 200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        id === "99999999" ? "Story not found" : "temporarily unavailable",
      );
      await expect(
        page.getByRole("complementary", { name: "Most read" }).getByRole("link"),
      ).toHaveCount(5);
    } finally {
      await context.close();
    }
  });

test.describe("article sidebar without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const [route, kind] of [
    [storyPath, "story"],
    ["/", "archive"],
    ["/2026/01", "archive"],
    ["/?category=models-products", "category"],
  ]) {
    test(`required read precedes popularity on ${route}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "fixture-read-order", value: kind, url: baseURL! }]);
      const response = await page.goto(route);
      expect(response!.status()).toBe(200);
      await expect(
        page.getByRole("complementary", { name: "Most read" }).getByRole("link"),
      ).toHaveCount(5);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      expect(await response!.text()).not.toContain("Loading most read stories");
    });
  }

  for (const state of ["ready", "slow", "empty", "failed"])
    test(`document response exposes the ${state} popularity result`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: "fixture-popularity", value: state, url: baseURL! }]);
      await page.goto(storyPath);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      const sidebar = page.getByRole("complementary", { name: "Most read" });
      await expect(sidebar).toBeVisible();
      await expect(sidebar).not.toContainText("Loading most read stories");
      if (state === "empty" || state === "failed") {
        await expect(sidebar).toContainText(
          state === "empty" ? "will appear as readers visit" : "temporarily unavailable",
        );
      } else {
        await expect(sidebar.getByRole("link")).toHaveCount(5);
        const next = sidebar.getByRole("link").nth(1);
        const href = await next.getAttribute("href");
        await next.click();
        await expect(page).toHaveURL(new RegExp(href!));
        await expect(sidebar.getByRole("link")).toHaveCount(5);
      }
    });
});

for (const width of [320, 1440])
  for (const textScale of [1, 2]) {
    test(`article sidebar and typography at ${width}px and ${textScale * 100}% text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(storyPath);
      await page.addStyleTag({ content: `html { font-size: ${textScale * 100}% !important; }` });
      await page.evaluate(() => document.fonts.ready);
      const article = page.locator("article.detail");
      const sidebar = page.getByRole("complementary", { name: "Most read" });
      await expect(article.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole("link")).toHaveCount(5);
      const articleBounds = (await article.boundingBox())!;
      const sidebarBounds = (await sidebar.boundingBox())!;
      if (width === 1440 && textScale === 1)
        expect(sidebarBounds.x).toBeGreaterThanOrEqual(articleBounds.x + articleBounds.width);
      else expect(sidebarBounds.y).toBeGreaterThanOrEqual(articleBounds.y + articleBounds.height);
      const bylineFont = await page
        .locator(".story-context time.story-age")
        .evaluate((node) => getComputedStyle(node).fontFamily);
      for (const text of await page.locator(".tldr-section p, .key-points li").all())
        await expect(text).toHaveCSS("font-family", bylineFont);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      for (const link of await sidebar.getByRole("link").all())
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("article.png"), fullPage: true });
    });
  }

test("feed, article, sidebar links and browser history retain Most read", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Most read" });
  await expect(sidebar).toBeVisible();
  const feedSidebarX = (await sidebar.boundingBox())!.x;
  await page.locator(".story-list").getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(storyPath));
  await expect(sidebar.getByRole("link")).toHaveCount(5);
  expect((await sidebar.boundingBox())!.x).toBeCloseTo(feedSidebarX, 0);
  const next = sidebar.getByRole("link").nth(1);
  const href = await next.getAttribute("href");
  await next.focus();
  await expect(next).toBeFocused();
  await next.press("Enter");
  await expect(page).toHaveURL(new RegExp(href!));
  await expect(sidebar).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(storyPath));
  await expect(sidebar).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(sidebar).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(storyPath));
  await expect(sidebar).toBeVisible();
});

for (const state of ["empty", "failed"])
  test(`article remains readable when popularity is ${state}`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "fixture-popularity", value: state, url: baseURL! }]);
    await page.goto(storyPath);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByRole("complementary", { name: "Most read" })).toContainText(
      state === "empty" ? "will appear as readers visit" : "temporarily unavailable",
    );
    await expect(page.locator(".tldr-section")).toBeVisible();
  });
