import { gunzipSync } from "node:zlib";
import { test, expect, storyPath } from "./browser";
import type { Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
// Exercise collection with a normal browser UA; the SDK correctly excludes bots.
test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
});
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
});

function payload(request: Request): unknown[] {
  const body = request.postDataBuffer();
  if (!body) return [];
  const text = body[0] === 31 && body[1] === 139 ? gunzipSync(body).toString() : body.toString();
  const parsed = JSON.parse(
    text.startsWith("data=")
      ? Buffer.from(new URLSearchParams(text).get("data")!, "base64").toString()
      : text,
  );
  return Array.isArray(parsed) ? parsed : (parsed.batch ?? [parsed]);
}

function expandReplay(value: unknown): unknown {
  if (typeof value === "string" && value.charCodeAt(0) === 31 && value.charCodeAt(1) === 139)
    return expandReplay(JSON.parse(gunzipSync(Buffer.from(value, "latin1")).toString()));
  if (Array.isArray(value)) return value.map(expandReplay);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandReplay(item)]),
    );
  return value;
}

test("new readers start analytics without a banner and withdrawal discards queued events", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => localStorage.removeItem("hacksnap:analytics-consent:v1"));
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (["eu.i.posthog.com", "eu-assets.i.posthog.com"].includes(new URL(request.url()).hostname))
      requests.push(request);
  });
  await page.goto(`${storyPath}?draft=PRIVATE_QUERY#PRIVATE_HASH`);
  await expect(page.getByRole("button", { name: "Allow analytics", exact: true })).toBeHidden();
  await expect(page.locator("#hacksnap-google-analytics")).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("hacksnap:analytics-consent:v1")),
  ).toBeNull();
  await expect
    .poll(() => requests.filter((r) => new URL(r.url()).pathname === "/e/").length)
    .toBeGreaterThan(0);
  const events = requests
    .filter((r) => new URL(r.url()).pathname === "/e/")
    .flatMap(payload) as Array<{ event: string; properties: Record<string, unknown> }>;
  expect(events.filter((e) => e.event === "$pageview")).toHaveLength(1);
  expect(events.filter((e) => e.event === "story_view")).toHaveLength(1);
  expect(events.filter((e) => e.event === "article_reading_start")).toHaveLength(1);
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE_QUERY|PRIVATE_HASH|draft=/);
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Turn analytics off", exact: true }).click();
  const count = requests.length;
  await page.waitForTimeout(5500);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.waitForTimeout(300);
  expect(requests).toHaveLength(count);
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((key) => /^(ph_|__ph_)/.test(key))),
  ).toEqual([]);
});

test("saved opt-outs stay off until the reader enables analytics", async ({ page, context }) => {
  await context.addInitScript(() =>
    localStorage.setItem("hacksnap:analytics-consent:v1", "declined"),
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/posthog\.com|googletagmanager\.com/.test(new URL(request.url()).hostname))
      requests.push(request.url());
  });
  await page.goto(storyPath);
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await expect(page.getByText("Analytics are off.", { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect(page.locator("#hacksnap-google-analytics")).toHaveCount(1);
});

test("returning consenting reader initializes without input", async ({ page, context }) => {
  await context.addInitScript(() =>
    localStorage.setItem("hacksnap:analytics-consent:v1", "accepted"),
  );
  const sent = page.waitForRequest(
    (r) => new URL(r.url()).hostname === "eu.i.posthog.com" && new URL(r.url()).pathname === "/e/",
  );
  await page.goto(storyPath);
  const events = payload(await sent) as Array<{ event: string }>;
  expect(events.filter((e) => e.event === "$pageview")).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Allow analytics", exact: true })).toBeHidden();
});

test("real replay snapshots and heatmaps exclude queries, hashes, inputs and share drafts", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    localStorage.setItem("hacksnap:analytics-consent:v1", "accepted");
    // This deterministic session hashes into the production 10% replay sample.
    localStorage.setItem(
      "ph_phc_browser_fixture_not_a_real_project_posthog",
      JSON.stringify({
        distinct_id: "browser-replay-fixture",
        $device_id: "browser-replay-fixture",
        $sesid: [Date.now(), "0199e870-0000-7000-8000-000000000070", Date.now()],
      }),
    );
  });
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (["eu.i.posthog.com", "eu-assets.i.posthog.com"].includes(new URL(request.url()).hostname))
      requests.push(request);
  });
  await page.goto(`${storyPath}?draft=PRIVATE_QUERY#PRIVATE_HASH`);
  await expect.poll(() => requests.some((r) => r.url().includes("recorder.js"))).toBe(true);
  await page.locator(".share-trigger").first().click();
  await page.locator(".share-draft").fill("PRIVATE_SHARE_DRAFT");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "analytics-mask-fixture";
    input.value = "PRIVATE_INPUT";
    document.body.appendChild(input);
  });
  await page.keyboard.press("Escape");
  await page.mouse.click(20, 20);
  await expect
    .poll(
      () =>
        JSON.stringify(
          requests.filter((r) => new URL(r.url()).pathname === "/e/").flatMap(payload),
        ).includes("$heatmap_data"),
      { timeout: 15000 },
    )
    .toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect
    .poll(() => requests.filter((r) => new URL(r.url()).pathname === "/s/").length)
    .toBeGreaterThan(0);
  const replay = requests
    .filter((r) => new URL(r.url()).pathname === "/s/")
    .flatMap(payload)
    .map(expandReplay);
  const text = JSON.stringify(replay);
  expect(text).toContain("$snapshot_data");
  expect(text).toContain("analytics-mask-fixture");
  expect(text).not.toMatch(/PRIVATE_QUERY|PRIVATE_HASH|PRIVATE_SHARE_DRAFT|PRIVATE_INPUT|draft=/);
  const events = requests.filter((r) => new URL(r.url()).pathname === "/e/").flatMap(payload);
  expect(JSON.stringify(events)).toContain("$heatmap_data");
  expect(JSON.stringify(events)).not.toMatch(
    /PRIVATE_QUERY|PRIVATE_HASH|PRIVATE_SHARE_DRAFT|PRIVATE_INPUT|draft=/,
  );
  // Include configuration/flags requests, not just the ingestion endpoints.
  for (const request of requests) {
    expect(decodeURIComponent(request.url())).not.toMatch(
      /PRIVATE_QUERY|PRIVATE_HASH|PRIVATE_SHARE_DRAFT|PRIVATE_INPUT/,
    );
    if (request.postDataBuffer())
      expect(JSON.stringify(expandReplay(payload(request)))).not.toMatch(
        /PRIVATE_QUERY|PRIVATE_HASH|PRIVATE_SHARE_DRAFT|PRIVATE_INPUT|draft=/,
      );
  }
});

test("query navigation and Back/Forward produce one pageview per occurrence", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    localStorage.setItem("hacksnap:analytics-consent:v1", "accepted"),
  );
  await page.goto("/?category=models-products&page=1");
  const views = () =>
    page.evaluate(
      () =>
        ((window as unknown as { dataLayer: Array<ArrayLike<unknown>> }).dataLayer ?? []).filter(
          (event) => event[0] === "event" && event[1] === "page_view",
        ).length,
    );
  await expect.poll(views).toBe(1);
  await page.evaluate(() =>
    history.pushState(null, "", "/?page=1&category=models-products&journey=temporary"),
  );
  await page.waitForTimeout(150);
  expect(await views()).toBe(1);
  await page.evaluate(() => history.pushState(null, "", "/?page=2&category=models-products"));
  await expect.poll(views).toBe(2);
  await page.goBack();
  await expect.poll(views).toBe(3);
  await page.goForward();
  await expect.poll(views).toBe(4);
  const leaves = await page.evaluate(
    () =>
      (window as unknown as { dataLayer: Array<ArrayLike<unknown>> }).dataLayer.filter(
        (event) => event[0] === "event" && event[1] === "page_leave",
      ).length,
  );
  expect(leaves).toBe(3);
});

test("withdrawal in another tab stops collection in an already open page", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    localStorage.setItem("hacksnap:analytics-consent:v1", "accepted"),
  );
  const sibling = await context.newPage();
  await sibling.goto("/topics");
  await page.goto(storyPath);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Record<string, unknown>)["ga-disable-G-059PVYBN82"],
      ),
    )
    .toBe(false);
  await sibling.evaluate(() => localStorage.setItem("hacksnap:analytics-consent:v1", "declined"));
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Record<string, unknown>)["ga-disable-G-059PVYBN82"],
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await expect(page.getByText("Analytics are off.", { exact: true })).toBeVisible();
  await sibling.close();
});

test("blocked storage cannot grant consent or interrupt reading", async ({ page, context }) => {
  await context.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const)
      Storage.prototype[method] = () => {
        throw new DOMException("Blocked", "SecurityError");
      };
  });
  const vendorRequests: string[] = [];
  page.on("request", (r) => {
    if (/posthog\.com|googletagmanager\.com/.test(new URL(r.url()).hostname))
      vendorRequests.push(r.url());
  });
  await page.goto(storyPath);
  await expect(page.getByRole("button", { name: "Allow analytics", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect(page.locator("#analytics-preferences").getByRole("status")).toContainText(
    "Analytics remain off",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(vendorRequests).toEqual([]);
});

test.describe("blocked analytics endpoints", () => {
  test.use({ expectedNetworkErrors: true });
  test("reading and navigation work when the vendor is blocked", async ({ page, context }) => {
    await context.addInitScript(() =>
      localStorage.setItem("hacksnap:analytics-consent:v1", "accepted"),
    );
    await page.route(/^https:\/\/(eu|eu-assets)\.i\.posthog\.com\//, (route) =>
      route.abort("blockedbyclient"),
    );
    await page.goto(storyPath);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Hacksnap home", exact: true }).click();
    await expect(page.locator(".story-list .feed-story-title a").first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

for (const width of [320, 1280])
  for (const scale of [1, 2]) {
    test(`consent controls at ${width}px and ${scale * 100}% text`, async ({
      page,
      context,
    }, testInfo) => {
      await context.addInitScript(() => localStorage.removeItem("hacksnap:analytics-consent:v1"));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(storyPath);
      await page.addStyleTag({ content: `html { font-size: ${scale * 100}% !important; }` });
      const panel = page.getByRole("region", { name: "Reading analytics" });
      await expect(panel).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath("banner-disabled.png") });
      await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const accept = page.getByRole("button", { name: "Allow analytics", exact: true });
      const decline = page.getByRole("button", { name: "Turn analytics off", exact: true });
      for (const button of [accept, decline])
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        (
          await new AxeBuilder({ page })
            .include("#analytics-preferences")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("consent.png") });
      await accept.focus();
      await page.keyboard.press("Tab");
      await expect(decline).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(panel).toBeHidden();
      const settings = page.getByRole("button", { name: "Analytics preferences", exact: true });
      await expect(settings).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(panel).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(settings).toBeFocused();
    });
  }
