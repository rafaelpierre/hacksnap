import { test, expect, title } from "./browser";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [320, 393, 768, 820, 1440])
  for (const textScale of [1, 2]) {
    test(`popularity widgets at ${width}px and ${textScale * 100}% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await page.evaluate(() => document.fonts.ready);
      const mostRead = page.getByRole("complementary", { name: "Most read", includeHidden: true });
      const trending = page.getByRole("complementary", {
        name: "Trending this week",
        includeHidden: true,
      });
      const feed = page.getByRole("region", { name: "Latest stories" });
      if (width <= 800) {
        await expect(mostRead).toBeHidden();
        await expect(trending).toBeHidden();
        await expect(page.getByRole("complementary", { name: "Most read" })).toHaveCount(0);
        await expect(feed.locator("h3").first()).toBeVisible();
      } else {
        await expect(mostRead).toBeVisible();
        await expect(trending).toBeVisible();
        await expect(mostRead.getByRole("link")).toHaveCount(5);
        await expect(trending.getByRole("link")).toHaveCount(5);
        await expect(mostRead.getByRole("link").first()).toHaveText(title);
        await expect(mostRead.getByRole("link").first()).toHaveAttribute("href", "/story/91000001");
        await expect(trending.getByRole("link").first()).toHaveAttribute("href", "/story/91000006");
        const trendingBounds = (await trending.boundingBox())!;
        const mostReadBounds = (await mostRead.boundingBox())!;
        const feedBounds = (await feed.boundingBox())!;
        expect(mostReadBounds.y).toBeGreaterThanOrEqual(trendingBounds.y + trendingBounds.height);
        if (width === 1440 && textScale === 1)
          expect(trendingBounds.x).toBeGreaterThan(feedBounds.x + feedBounds.width - 1);
        else expect(mostReadBounds.y + mostReadBounds.height).toBeLessThanOrEqual(feedBounds.y);
        await expect(page.locator(".browse-right-sidebar")).not.toContainText("All time");
        await expect(page.getByRole("tablist")).toHaveCount(0);
        for (const widget of [trending, mostRead]) {
          for (const link of await widget.getByRole("link").all())
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await widget.getByRole("link").first().focus();
          await expect(widget.getByRole("link").first()).toBeFocused();
        }
      }
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      const output = path.resolve("../../docs/ux/2026-10-08/popularity-widgets");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `home-${width}-${textScale * 100}.png`),
        animations: "disabled",
      });
      await page.goto("/2026/01");
      await expect(page.locator(".popular-stories")).toHaveCount(0);
    });
  }

test("weekly outage preserves Most read and each widget has a distinct empty message", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "fixture-popularity", value: "weekly-failed", url: baseURL! }]);
  await page.goto("/");
  const trending = page.getByRole("complementary", { name: "Trending this week" });
  const mostRead = page.getByRole("complementary", { name: "Most read" });
  await expect(trending).toContainText("temporarily unavailable");
  await expect(mostRead.getByRole("link")).toHaveCount(5);
  await context.addCookies([{ name: "fixture-popularity", value: "empty", url: baseURL! }]);
  await page.reload();
  await expect(trending).toContainText("No story reads recorded in the last 7 days.");
  await expect(mostRead).toContainText("will appear as readers visit");
});

test("slow hidden popularity leaves the phone feed available without layout shift", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await context.addCookies([{ name: "fixture-popularity", value: "slow", url: baseURL! }]);
  await page.addInitScript(() => {
    const state = window as unknown as Window & { popularityCLS: number };
    state.popularityCLS = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput)
          state.popularityCLS += (entry as PerformanceEntry & { value: number }).value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/", { waitUntil: "commit" });
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".browse-right-sidebar")).toBeHidden();
  await expect(page.locator(".popular-stories ol li")).toHaveCount(10);
  expect(
    await page.evaluate(
      () => (window as unknown as Window & { popularityCLS: number }).popularityCLS,
    ),
  ).toBeLessThanOrEqual(0.1);
});

test("both server-rendered lists remain usable without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    for (const name of ["Trending this week", "Most read"])
      await expect(page.getByRole("complementary", { name }).getByRole("link")).toHaveCount(5);
    await page
      .getByRole("complementary", { name: "Trending this week" })
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/story\/91000006/);
  } finally {
    await context.close();
  }
});

test("a failed popularity read leaves the homepage feed available", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "fixture-popularity", value: "failed", url: baseURL! }]);
  await page.goto("/");
  for (const name of ["Trending this week", "Most read"])
    await expect(page.getByRole("complementary", { name })).toContainText(
      "temporarily unavailable",
    );
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
});

test("keyboard activation records a click separately from the mounted story view and reload", async ({
  page,
  context,
}) => {
  const events: Array<{ kind: string; story_id: string; visit_id: string }> = [];
  let releaseRuntime!: () => void;
  const runtimeGate = new Promise<void>((resolve) => {
    releaseRuntime = resolve;
  });
  await context.route("**/_next/static/chunks/*.js", async (route) => {
    await runtimeGate;
    await route.fallback();
  });
  await context.route("**/api/story-events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, body: "" });
  });
  const first = page.getByRole("complementary", { name: "Most read" }).getByRole("link").first();
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(first).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("hacksnap:visit-anchor"))).toBeNull();
  } finally {
    releaseRuntime();
  }
  await page.waitForFunction(() => Number(localStorage.getItem("hacksnap:visit-anchor")) > 0);
  await first.focus();
  await first.press("Enter");
  await expect(page).toHaveURL(/\/story\/91000001/);
  await expect
    .poll(() => events.map(({ kind, story_id }) => [kind, story_id]).sort())
    .toEqual([
      ["click", "91000001"],
      ["view", "91000001"],
    ]);
  expect(new Set(events.map(({ visit_id }) => visit_id)).size).toBe(2);
  for (const event of events)
    expect(Object.keys(event).sort()).toEqual(["kind", "story_id", "visit_id"]);
  await page.reload();
  await expect
    .poll(() => events.map(({ kind, story_id }) => [kind, story_id]).sort())
    .toEqual([
      ["click", "91000001"],
      ["view", "91000001"],
      ["view", "91000001"],
    ]);
  for (const event of events)
    expect(Object.keys(event).sort()).toEqual(["kind", "story_id", "visit_id"]);
  expect(
    new Set(events.filter(({ kind }) => kind === "view").map(({ visit_id }) => visit_id)).size,
  ).toBe(2);
});
