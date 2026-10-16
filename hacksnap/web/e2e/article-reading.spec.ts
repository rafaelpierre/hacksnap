import { test, expect, storyPath } from "./browser";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem("hacksnap:analytics-consent:v1", "accepted"),
  );
});

type ReadingEvent = {
  name: string;
  visit_id?: string;
  story_id?: string;
  section_id?: string;
  action?: string;
  checkpoint_reason?: string;
};
async function events(page: Page): Promise<ReadingEvent[]> {
  return page.evaluate(() => {
    const layer = (window as Window & { dataLayer?: Array<ArrayLike<unknown>> }).dataLayer ?? [];
    return layer
      .filter((args) => args[0] === "event")
      .map((args) => ({ name: String(args[1]), ...(args[2] as Record<string, string>) }));
  });
}

for (const width of [320, 1280]) {
  test(`article reading observes passive visits and expanded content at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(storyPath);
    await expect(page.locator("#hacksnap-google-analytics")).toHaveCount(1);
    await expect
      .poll(async () =>
        (await events(page)).some(
          (e) => e.name === "article_section_view" && e.section_id === "opening_1",
        ),
      )
      .toBe(true);
    const topic = page.locator(".analysis-theme-section").first();
    await topic.locator("h3").scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        (await events(page)).some(
          (e) => e.name === "article_section_view" && e.section_id === "theme_heading_1",
        ),
      )
      .toBe(true);
    await topic.locator(".analysis-theme-body").scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        (await events(page)).some(
          (e) => e.name === "article_section_view" && e.section_id === "theme_body_1",
        ),
      )
      .toBe(true);
    expect((await events(page)).some((e) => e.name === "article_theme_toggle")).toBe(false);
    await expect(topic.locator("button, details")).toHaveCount(0);
  });
}

test("article navigation and Back/Forward use distinct visits and preserve old checkpoints", async ({
  page,
}) => {
  await page.goto(storyPath);
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "article_reading_start").length)
    .toBe(1);
  const first = (await events(page)).find((e) => e.name === "article_reading_start")!;
  await page.locator(".related-story-list a").first().click();
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "article_reading_start").length)
    .toBe(2);
  const checkpoint = (await events(page)).find(
    (e) => e.name === "article_reading_checkpoint" && e.checkpoint_reason === "route",
  );
  expect(checkpoint?.story_id).toBe(first.story_id);
  expect(checkpoint?.visit_id).toBe(first.visit_id);
  await page.goBack();
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "article_reading_start").length)
    .toBe(3);
  const starts = (await events(page)).filter((e) => e.name === "article_reading_start");
  expect(new Set(starts.map((e) => e.visit_id)).size).toBe(3);
  await page.goForward();
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "article_reading_start").length)
    .toBe(4);
  const forward = (await events(page)).filter((e) => e.name === "article_reading_start");
  expect(new Set(forward.map((e) => e.visit_id)).size).toBe(4);
});
