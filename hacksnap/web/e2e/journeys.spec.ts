import { test, expect, title, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const route of ["/", "/archive", "/category/models-products"]) {
  test(`reading journey and native history from ${route}`, async ({ page }) => {
    await page.goto(route);
    const card = page.getByRole("link", { name: title, exact: true });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const returnName =
      route === "/"
        ? "Top Stories"
        : route === "/archive"
          ? "Back to Latest stories"
          : "Models & Products";
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: returnName, exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === route);
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
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  // The wordmark opens a new / entry through the Next router, independently of
  // the saved story-return journey. Never synthesize entries with pushState.
  await page.getByRole("link", { name: "Hacksnap home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page
    .getByRole("link", { name: "Practical AI research update 10", exact: true })
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
  await expect(page.getByRole("link", { name: title, exact: true })).toBeInViewport();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("keyboard source popover and share controls preserve focus and accessibility", async ({
  page,
}) => {
  await page.goto(storyPath);
  const source = page.getByRole("button", {
    name: "Source comments for Maintenance costs still matter.",
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

test("blocked storage and clipboard retain theme, navigation and manual copy", async ({
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
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: title, exact: true }).click();
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
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
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
    await page.route("**/api/ready-stories?**", async (route) => {
      if (fail)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Stories are temporarily unavailable" }),
        });
      else await route.fallback();
    });
    await page.goto("/");
    await page
      .getByRole("link", { name: "Practical AI research update 10", exact: true })
      .scrollIntoViewIfNeeded();
    const retry = page.getByRole("button", { name: "Try loading again", exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(1);
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

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("server content and ordinary links remain readable", async ({ page }) => {
    await page.goto("/archive");
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "TLDR;", exact: true })).toBeVisible();
    const source = page.getByRole("button", {
      name: "Source comments for Maintenance costs still matter.",
    });
    await source.click();
    await expect(page.getByRole("dialog", { name: "Source comments", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Top Stories", exact: true })
      .click();
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
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
  await expect(page).toHaveURL(/\/category\/models-products$/);
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
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
  const link = page.getByRole("link", { name: title, exact: true });
  await link.click();
  try {
    await expect(link).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "Opening story…" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI news for people who build." }),
    ).toBeVisible();
  } finally {
    release!();
  }
  await expect(page).toHaveURL(new RegExp(`${storyPath}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});
