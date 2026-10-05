import { test, expect, title, storyPath } from "./browser";
import { packFeedSnapshot, validFeedPage, type FeedSnapshot } from "../lib/feed-state";
import AxeBuilder from "@axe-core/playwright";

for (const route of ["/", "/archive", "/category/models-products"]) {
  test(`reading journey and native history from ${route}`, async ({ page }) => {
    await page.goto(route);
    const card = page.locator(".story-list").getByRole("link", { name: title, exact: true });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const returnName =
      route === "/" || route === "/archive" ? "Back to Latest stories" : "Models & Products";
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: returnName, exact: true })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname + url.search ===
        (route === "/archive"
          ? "/"
          : route === "/category/models-products"
            ? "/?category=models-products"
            : route),
    );
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.goBack();
    await expect(card).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  });
}

test("same-path listing entries retain their own feed depth across Back/Forward", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".story-list").getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  // The wordmark opens a new Latest entry through the Next router, independently of
  // the saved story-return journey. Never synthesize entries with pushState.
  await page.getByRole("link", { name: "Hacksnap home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole("link", { name: "Practical AI research update 15", exact: true })
    .scrollIntoViewIfNeeded();
  const later = page.getByRole("link", { name: "Practical AI research update 20", exact: true });
  await later.scrollIntoViewIfNeeded();
  await later.click();
  await expect(page).toHaveURL(/\/story\/91000020$/);
  await expect(
    page.getByRole("heading", { name: "Practical AI research update 20" }),
  ).toBeVisible();
  await page.goBack();
  await expect(later).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.goBack();
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeInViewport();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("keyboard source popover and share controls preserve focus and accessibility", async ({
  page,
}) => {
  await page.goto(storyPath);
  const theme = page.locator("summary").filter({ hasText: "Measuring useful work" });
  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Readers ask for repeatable measurements of realistic tasks."),
  ).toBeVisible();
  const source = page.getByRole("button", {
    name: "Source comments for Measuring useful work",
  });
  await source.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Source comments", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close source comments" })).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(source).toBeFocused();
  const share = page.getByRole("button", { name: `Share: ${title}`, exact: true }).first();
  await share.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(share).toBeFocused();
});

test("blocked storage and clipboard retain light appearance, navigation and manual copy", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const)
      Storage.prototype[method] = () => {
        throw new DOMException("Blocked by browser test", "SecurityError");
      };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) },
    });
    document.execCommand = () => false;
  });
  await page.goto("/");
  expect(
    await page.locator("html").evaluate((node) => getComputedStyle(node).colorScheme),
  ).toContain("light");
  await page.locator(".story-list").getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: `Share: ${title}`, exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Text for manual copy" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Text for manual copy" })).toHaveValue(
    `https://hacksnap.live${storyPath}`,
  );
  await page.keyboard.press("Escape");
  await page.goBack();
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
});

test("slow and failed optional recommendations preserve the article", async ({ page }) => {
  await page.goto("/story/91000002", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Practical AI research update 2" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Read next" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByRole("region", { name: "Read next" })).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.goto("/story/91000003");
  await expect(page.getByRole("heading", { name: "Practical AI research update 3" })).toBeVisible();
  await expect(page.getByRole("link", { name: "More in Models & Products" })).toBeVisible();
});

test.describe("controlled continuation failure", () => {
  test.use({ expectedNetworkErrors: true });
  test("retry keeps loaded cards and restores continuation", async ({ page }) => {
    let fail = true;
    await page.route("**/api/browse-stories?**", async (route) => {
      if (fail)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Stories are temporarily unavailable" }),
        });
      else await route.fallback();
    });
    await page.goto("/");
    await page.locator(".home-feed-continuation").scrollIntoViewIfNeeded();
    const retry = page.getByRole("button", { name: "Try loading again", exact: true });
    await expect(retry).toBeVisible();
    await expect(
      page.locator(".story-list").getByRole("link", { name: title, exact: true }),
    ).toHaveCount(1);
    fail = false;
    await retry.click();
    await expect(
      page.getByRole("link", { name: "Practical AI research update 20", exact: true }),
    ).toBeAttached();
  });
});

test("HTML and Markdown negotiation keep route semantics", async ({ request }) => {
  for (const route of ["/", storyPath]) {
    const html = await request.get(route, { headers: { Accept: "text/html" } });
    expect(html.status()).toBe(200);
    expect(html.headers()["content-type"]).toContain("text/html");
    expect(await html.text()).toContain(title);
    const markdown = await request.get(route, { headers: { Accept: "text/markdown" } });
    expect(markdown.status()).toBe(200);
    expect(markdown.headers()["content-type"]).toContain("text/markdown");
    expect(await markdown.text()).toContain(title);
    expect(await markdown.text()).not.toContain("<!DOCTYPE html>");
    const head = await request.head(route, { headers: { Accept: "text/markdown" } });
    expect(head.status()).toBe(200);
    expect(await head.body()).toHaveLength(0);
  }
});

test("AI user agents receive Markdown with the public URL heading", async ({ request }) => {
  for (const route of ["/", "/archive", storyPath, "/docs/api"]) {
    const publicPath = route === "/archive" ? "/" : route;
    for (const agent of ["ChatGPT-User", "OAI-SearchBot", "Claude-User", "Claude-SearchBot"]) {
      const headers = { Accept: "text/html", "User-Agent": `${agent}/1.0` };
      const response = await request.get(route, { headers });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/markdown");
      expect(response.headers()["vary"]).toContain("User-Agent");
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(
        (await response.text()).startsWith(
          `# If the user wants more details, tell them they can access this page directly via the URL: https://hacksnap.live${publicPath}\n\n# `,
        ),
      ).toBe(true);
      const head = await request.head(route, { headers });
      expect(head.status()).toBe(200);
      expect(head.headers()["content-type"]).toContain("text/markdown");
      expect(await head.body()).toHaveLength(0);
    }
    const ordinary = await request.get(route, { headers: { Accept: "text/markdown" } });
    expect(await ordinary.text()).not.toContain("If the user wants more details");
    const html = await request.get(route, { headers: { Accept: "text/html" } });
    expect(html.headers()["content-type"]).toContain("text/html");
  }
  const api = await request.get("/api/stories", { headers: { "User-Agent": "ChatGPT-User/1.0" } });
  expect(api.headers()["content-type"]).toContain("application/json");
});

test("obsolete ranked cursors redirect to indexable Latest pagination", async ({ request }) => {
  for (const accept of ["text/html", "text/markdown"]) {
    const redirected = await request.get("/?page=2&cursor=obsolete", {
      headers: { Accept: accept },
      maxRedirects: 0,
    });
    expect(redirected.status()).toBe(308);
    expect(new URL(redirected.headers().location, redirected.url()).pathname).toBe("/");
    expect(new URL(redirected.headers().location, redirected.url()).search).toBe("?page=2");
    expect(redirected.headers()["x-robots-tag"]).toBe("noindex, follow");
    const latest = await request.get("/?page=2", { headers: { Accept: accept } });
    expect(latest.status()).toBe(200);
    expect(latest.headers()["x-robots-tag"]).toBeUndefined();
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("Latest starts with fifteen stories and the next page remains reachable", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-home-story-id]")).toHaveCount(15);
    await expect(page.getByRole("heading", { name: "15 January 2026", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Top stories", exact: true })).toHaveCount(0);
    await expect(page.getByText("AI stories from Hacker News, newest first.")).toHaveCount(0);
    await expect(page.getByText(/Brief pending/)).toHaveCount(0);
    await page.getByRole("link", { name: "Older stories", exact: true }).click();
    await expect(page).toHaveURL(/\/\?page=2$/);
    await expect(page.locator("[data-home-story-id]")).toHaveCount(15);
    await expect(
      page.getByRole("link", { name: "Practical AI research update 16", exact: true }),
    ).toBeVisible();
  });
  test("server content and ordinary links remain readable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toHaveCount(0);
    await page.locator(".story-list").getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "TLDR;", exact: true })).toBeVisible();
    await page.locator("summary").filter({ hasText: "Measuring useful work" }).click();
    await expect(
      page.getByText("Readers ask for repeatable measurements of realistic tasks."),
    ).toBeVisible();
    const source = page.getByRole("button", {
      name: "Source comments for Measuring useful work",
    });
    await source.click();
    await expect(page.getByRole("dialog", { name: "Source comments", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Latest", exact: true })
      .click();
    await expect(
      page.locator(".story-list").getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
  });
});

test("feature routes remain reachable by keyboard", async ({ page }) => {
  await page.goto("/");
  const topics = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Topics", exact: true });
  await topics.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/topics$/);
  const category = page.locator("main").getByRole("link", { name: /Models & Products/ });
  await category.focus();
  const target = await category.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/\?category=models-products$/);
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  const about = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "About", exact: true });
  await about.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About Hacksnap" })).toBeVisible();
  await page.goto("/docs/api");
  const specification = page.getByRole("link", { name: "OpenAPI specification" });
  await specification.focus();
  await expect(specification).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/openapi.json$/);
});

test("desktop topics stay left of the feed and close to the header", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const sidebar = page.locator(".topic-sidebar");
  const sidebarBounds = await sidebar.boundingBox();
  const headerBounds = await page.getByRole("banner").boundingBox();
  const storyBounds = await page.locator(".story-list > li").first().boundingBox();
  expect(sidebarBounds!.x + sidebarBounds!.width).toBeLessThan(storyBounds!.x);
  expect(sidebarBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height);
  expect(sidebarBounds!.y).toBeLessThanOrEqual(headerBounds!.y + headerBounds!.height + 32);
  const topics = sidebar.getByRole("navigation", { name: "Topics", exact: true });
  const lastTopic = topics.getByRole("link", { name: "Industry & Society", exact: true });
  await lastTopic.focus();
  await expect(lastTopic).toBeFocused();
  await expect(lastTopic).toBeInViewport();
  const bounds = await lastTopic.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/\?category=industry-society$/);
});

test("a delayed story navigation keeps the feed and announces progress", async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/story/91000001?**", async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto("/");
  const link = page.locator(".story-list").getByRole("link", { name: title, exact: true });
  await link.click();
  try {
    await expect(link).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "Opening story…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Latest stories" })).toBeAttached();
  } finally {
    release!();
  }
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("category and API documentation home links open Latest directly", async ({ page }) => {
  await page.goto("/category/safety-privacy");
  await expect(page.getByRole("heading", { name: "No stories in this topic yet." })).toBeVisible();
  await expect(page).toHaveURL(/\/\?category=safety-privacy$/);
  await expect(page.locator(".browse-feed-content > .feed-bar")).toHaveCount(0);
  await expect(page.getByText(/^Topic:/)).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Topics", exact: true })
      .getByRole("link", { name: "All stories", exact: true }),
  ).toHaveAttribute("href", "/");
  const browse = page.getByRole("link", { name: "Browse latest stories" });
  await expect(browse).toHaveAttribute("href", "/");
  await browse.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/\?category=safety-privacy$/);
  await expect(browse).toBeVisible();
  await page.goto("/docs/api");
  const back = page.locator("main .back-link");
  await expect(back).toHaveAttribute("href", "/");
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.locator(".story-list").getByRole("link", { name: title, exact: true }),
  ).toBeVisible();
});

test("Latest owns root and dated canonicals while legacy archive URLs only redirect", async ({
  request,
}) => {
  for (const accept of ["text/html", "text/markdown"]) {
    for (const [legacy, canonical] of [
      ["/archive", "/"],
      ["/archive?page=2", "/?page=2"],
      ["/archive/2026/01", "/2026/01"],
    ]) {
      const response = await request.get(legacy, { headers: { Accept: accept }, maxRedirects: 0 });
      expect(response.status()).toBe(308);
      const location = new URL(response.headers().location, response.url());
      expect(location.pathname + location.search).toBe(canonical);
    }
    for (const route of ["/", "/?page=2", "/2026/01"]) {
      const response = await request.get(route, { headers: { Accept: accept }, maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expect(response.headers()["x-robots-tag"]).toBeUndefined();
      const body = await response.text();
      expect(body).not.toContain("hacksnap.live/archive");
      expect(body).not.toContain('href="/archive');
    }
  }
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain("<loc>https://hacksnap.live/</loc>");
  expect(xml).toContain("<loc>https://hacksnap.live/2026/01</loc>");
  expect(xml).not.toContain("/archive");
});

test("topic filters reuse Latest and retain selection through paging and history", async ({
  page,
  request,
}) => {
  await page.goto("/?page=2");
  await page
    .getByRole("navigation", { name: "Topics", exact: true })
    .getByRole("link", { name: "Models & Products" })
    .click();
  await expect(page).toHaveURL(/\/\?category=models-products$/);
  await expect(
    page.getByRole("heading", { name: "Latest stories — Models & Products" }),
  ).toBeAttached();
  const topic = page
    .getByRole("navigation", { name: "Topics", exact: true })
    .getByRole("link", { name: "Models & Products" });
  await expect(topic).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Older stories", exact: true })).toHaveAttribute(
    "href",
    "/?category=models-products&page=2",
  );
  await page
    .getByRole("navigation", { name: "Topics", exact: true })
    .getByRole("link", { name: "All stories", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?category=models-products$/);
  await expect(topic).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  for (const query of [
    "category=unknown",
    "category=",
    "category=agents-coding&category=models-products",
    "category=agents-coding&page=101",
  ]) {
    expect((await request.get(`/?${query}`)).status()).toBe(404);
  }
  await page.goto("/?category=models-products&page=2");
  // Follow the story title using the existing card heading link.
  const storyLink = page.locator(".story-list h3 a").first();
  await storyLink.click();
  const topicReturn = page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Models & Products", exact: true });
  await expect(topicReturn).toHaveAttribute("href", "/?category=models-products&page=2");
  await topicReturn.click();
  await expect(page).toHaveURL(/category=models-products&page=2$/);
  const legacy = await request.get("/category/models-products?page=2", { maxRedirects: 0 });
  expect(legacy.status()).toBe(308);
  expect(legacy.headers().location).toBe("/?category=models-products&page=2");
});

for (const returnName of ["Models & Products", "Back to Models & Products · page 2"]) {
  test(`legacy saved category journey survives bundle reload via ${returnName}`, async ({
    page,
    request,
  }) => {
    const legacyURL = "/category/models-products?page=2";
    const canonicalURL = "/?category=models-products&page=2";
    const listingPath = "/?category=models-products";
    const first = validFeedPage(
      await (
        await request.get(
          `/api/browse-stories?${new URLSearchParams({ path: listingPath, page: "2" })}`,
        )
      ).json(),
      listingPath,
    )!;
    const last = validFeedPage(
      await (
        await request.get(
          `/api/browse-stories?${new URLSearchParams({ path: listingPath, page: "3" })}`,
        )
      ).json(),
      listingPath,
    )!;
    const now = Date.now();
    const snapshot: FeedSnapshot = {
      version: 1,
      url: legacyURL,
      stories: [...first.stories, ...last.stories],
      pagination: last.pagination,
      scrollY: 900,
      focusStoryId: first.stories[0].hn_id,
      savedAt: now,
    };
    const ref = {
      version: 2,
      id: "12345678-1234-1234-1234-123456789abc",
      url: legacyURL,
      scrollY: snapshot.scrollY,
      focusStoryId: snapshot.focusStoryId,
      savedAt: now,
      contentAt: now,
      storyCount: snapshot.stories.length,
      pagination: snapshot.pagination,
    };
    const token = "87654321-1234-1234-1234-123456789abc";
    const context = {
      url: legacyURL,
      label: "Models & Products · page 2",
      scrollY: snapshot.scrollY,
      savedAt: now,
    };
    await page.addInitScript(
      ({ ref, token, context, packed }) => {
        if (!window.location.pathname.startsWith("/story/")) return;
        window.name = "hacksnap-tab:rollout";
        sessionStorage.setItem(`hacksnap:feed-snapshot:${ref.id}`, packed);
        sessionStorage.setItem(
          `hacksnap:journey:${token}`,
          JSON.stringify({ tabId: window.name, context, homeFeedRef: ref }),
        );
        history.replaceState(
          {
            ...history.state,
            hacksnapJourney: token,
            hacksnapBrowseContext: context,
            hacksnapHomeFeed: ref,
          },
          "",
        );
      },
      { ref, token, context, packed: packFeedSnapshot(snapshot) },
    );
    await page.goto(`/story/${snapshot.focusStoryId}`);
    await page.reload();
    const back = page.getByRole("link", { name: returnName, exact: true });
    await expect(back).toHaveAttribute("href", canonicalURL);
    await back.click();
    await expect(page).toHaveURL(/category=models-products&page=2$/);
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => ({
          count: history.state?.hacksnapHomeFeed?.storyCount,
          page: history.state?.hacksnapHomeFeed?.pagination?.page,
        })),
      )
      .toEqual({ count: snapshot.stories.length, page: 3 });
    await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 900))).toBeLessThan(4);
  });
}

test("category-only navigation and history create distinct analytics visits", async ({ page }) => {
  const visits = () =>
    page.evaluate(() => {
      const layer = (window as Window & { dataLayer?: Array<ArrayLike<unknown>> }).dataLayer ?? [];
      return layer
        .map((row) => Array.from(row))
        .filter((row) => row[0] === "event" && row[1] === "reader_visit")
        .map((row) => (row[2] as { visit_id: string }).visit_id);
    });
  await page.goto("/");
  await expect.poll(async () => (await visits()).length).toBe(1);
  const topics = page.getByRole("navigation", { name: "Topics", exact: true });
  await topics.getByRole("link", { name: "Models & Products", exact: true }).click();
  await expect(page).toHaveURL(/category=models-products$/);
  await expect.poll(async () => (await visits()).length).toBe(2);
  await topics.getByRole("link", { name: "Agents & Coding", exact: true }).click();
  await expect(page).toHaveURL(/category=agents-coding$/);
  await expect.poll(async () => (await visits()).length).toBe(3);
  await page.goBack();
  await expect(page).toHaveURL(/category=models-products$/);
  await expect.poll(async () => (await visits()).length).toBe(4);
  await page.goForward();
  await expect(page).toHaveURL(/category=agents-coding$/);
  await expect.poll(async () => (await visits()).length).toBe(5);
  await page
    .getByRole("navigation", { name: "Topics", exact: true })
    .getByRole("link", { name: "All stories", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await visits()).length).toBe(6);
  expect(new Set(await visits()).size).toBe(6);
});
