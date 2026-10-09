import { test, expect, title } from "./browser";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [320, 393, 768, 820, 1440])
  for (const textScale of [1, 2]) {
    test(`popularity widgets at ${width}px and ${textScale * 100}% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await expect(page.locator(".menu-button")).toHaveAttribute("aria-expanded", "false");
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await page.evaluate(() => document.fonts.ready);
      const mostRead = page.getByRole("complementary", { name: "Most read", includeHidden: true });
      const trending = page.getByRole("complementary", {
        name: "Trending",
        includeHidden: true,
      });
      const feed = page.getByRole("region", { name: "Latest stories" });
      {
        await expect(mostRead).toBeVisible();
        await expect(trending).toBeVisible();
        await expect(mostRead.getByRole("link")).toHaveCount(5);
        await expect(mostRead.getByRole("link").first()).toHaveText(title);
        await expect(mostRead.getByRole("link").first()).toHaveAttribute("href", "/story/91000001");
        await expect(trending.getByRole("link")).toHaveCount(5);
        await expect(trending.getByRole("link").first()).toHaveAttribute("href", "/story/91000006");
        const trendingBounds = (await trending.boundingBox())!;
        const mostReadBounds = (await mostRead.boundingBox())!;
        const feedBounds = (await feed.boundingBox())!;
        expect(trendingBounds.y + trendingBounds.height).toBeLessThanOrEqual(mostReadBounds.y);
        if (width === 1440 && textScale === 1)
          expect(mostReadBounds.x).toBeGreaterThan(feedBounds.x + feedBounds.width - 1);
        else expect(mostReadBounds.y).toBeGreaterThanOrEqual(feedBounds.y + feedBounds.height);
        await expect(page.locator(".browse-right-sidebar")).not.toContainText("All time");
        await expect(page.getByRole("tablist")).toHaveCount(0);
        for (const widget of [trending, mostRead]) {
          for (const link of await widget.getByRole("link").all())
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await widget.getByRole("link").first().focus();
          await expect(widget.getByRole("link").first()).toBeFocused();
        }
      }
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 244, 245)");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      const output = path.resolve("../../docs/ux/2026-10-09/restore-trending");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `home-${width}-${textScale * 100}.png`),
        animations: "disabled",
      });
      await page.goto("/2026/01");
      await expect(page.locator(".popular-stories")).toHaveCount(2);
    });
  }

test("weekly outage preserves Most read and empty lifetime ranking is explicit", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "fixture-popularity", value: "weekly-failed", url: baseURL! }]);
  await page.goto("/");
  const trending = page.getByRole("complementary", { name: "Trending" });
  const mostRead = page.getByRole("complementary", { name: "Most read" });
  await expect(trending).toContainText("Trending stories are temporarily unavailable.");
  await expect(mostRead.getByRole("link")).toHaveCount(5);
  await context.addCookies([{ name: "fixture-popularity", value: "empty", url: baseURL! }]);
  await page.reload();
  await expect(mostRead).toContainText("will appear as readers visit");
  await expect(trending).toContainText("No story reads recorded in the last 7 days.");
});

test("slow popularity below the phone feed leaves stories available without layout shift", async ({
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
  await expect(page.locator(".browse-right-sidebar")).toBeVisible();
  await expect(page.locator(".popular-stories ol li")).toHaveCount(10);
  expect(
    await page.evaluate(
      () => (window as unknown as Window & { popularityCLS: number }).popularityCLS,
    ),
  ).toBeLessThanOrEqual(0.1);
});

test("server-rendered popularity remains usable without JavaScript", async ({
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
    for (const name of ["Trending", "Most read"])
      await expect(page.getByRole("complementary", { name }).getByRole("link")).toHaveCount(5);
    await page.getByRole("complementary", { name: "Most read" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/story\/91000001/);
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
  for (const name of ["Trending", "Most read"])
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
