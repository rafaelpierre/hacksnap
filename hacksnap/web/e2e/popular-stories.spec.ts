import { test, expect, title } from "./browser";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [320, 1440])
  for (const textScale of [1, 2]) {
    test(`most read at ${width}px and ${textScale * 100}% text`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await page.evaluate(() => document.fonts.ready);
      const sidebar = page.getByRole("complementary", { name: "Most read" });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole("link")).toHaveCount(5);
      await expect(sidebar.getByRole("link").first()).toHaveText(title);
      await expect(sidebar.getByRole("link").first()).toHaveAttribute("href", "/story/91000001");
      const feed = await page.getByRole("region", { name: "Latest stories" }).boundingBox();
      const bounds = await sidebar.boundingBox();
      if (width === 1440 && textScale === 1)
        expect(bounds!.x).toBeGreaterThan(feed!.x + feed!.width - 1);
      else {
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(feed!.y);
      }
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      for (const link of await sidebar.getByRole("link").all())
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await sidebar.getByRole("link").first().focus();
      await expect(sidebar.getByRole("link").first()).toBeFocused();
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      const output = path.resolve("../../docs/ux/2026-10-05/popular-stories");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `home-${width}-${textScale * 100}.png`),
        animations: "disabled",
      });
      await page.goto("/2026/01");
      await expect(page.getByRole("complementary", { name: "Most read" })).toHaveCount(0);
    });
  }

test("slow optional popularity leaves the feed usable and keeps mobile layout shift within the existing budget", async ({
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
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: "Loading most read" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Most read" }).getByRole("link"),
  ).toHaveCount(5);
  expect(
    await page.evaluate(
      () => (window as unknown as Window & { popularityCLS: number }).popularityCLS,
    ),
  ).toBeLessThanOrEqual(0.1);
});

test("a failed popularity read leaves the homepage feed available", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "fixture-popularity", value: "failed", url: baseURL! }]);
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Most read" })).toContainText(
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
  await context.route("**/api/story-events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, body: "" });
  });
  await page.goto("/");
  const first = page.getByRole("complementary", { name: "Most read" }).getByRole("link").first();
  await first.focus();
  await first.press("Enter");
  await expect(page).toHaveURL(/\/story\/91000001/);
  await expect.poll(() => events.filter(({ kind }) => kind === "view").length).toBe(1);
  expect(events.map(({ kind, story_id }) => [kind, story_id])).toEqual([
    ["click", "91000001"],
    ["view", "91000001"],
  ]);
  expect(new Set(events.map(({ visit_id }) => visit_id)).size).toBe(2);
  for (const event of events)
    expect(Object.keys(event).sort()).toEqual(["kind", "story_id", "visit_id"]);
  await page.reload();
  await expect.poll(() => events.filter(({ kind }) => kind === "view").length).toBe(2);
  expect(
    new Set(events.filter(({ kind }) => kind === "view").map(({ visit_id }) => visit_id)).size,
  ).toBe(2);
});
