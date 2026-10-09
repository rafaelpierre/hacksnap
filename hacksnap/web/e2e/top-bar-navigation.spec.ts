import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./browser";

for (const destination of [
  { navigation: "Topic navigation", name: "Browse by topic", url: /\/topics$/ },
  { navigation: "Main navigation", name: "About", url: /\/about$/ },
]) {
  test(`${destination.name} retains keyboard focus through hydration`, async ({ page }) => {
    // Hold React's streamed-boundary reveal until a reader has focused a link.
    await page.addInitScript(() => {
      const requestFrame = window.requestAnimationFrame.bind(window);
      const frames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = (callback) => frames.push(callback);
      window.addEventListener(
        "test:reveal-stream",
        () => {
          window.requestAnimationFrame = requestFrame;
          for (const callback of frames) requestFrame(callback);
        },
        { once: true },
      );
    });
    await page.goto("/?category=models-products");
    const link = page
      .getByRole("navigation", { name: destination.navigation, exact: true })
      .getByRole("link", { name: destination.name, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event("test:reveal-stream")));
    // The selected topic appears once the search-parameter reader has hydrated.
    await expect(
      page
        .getByRole("navigation", { name: "Topic navigation", exact: true })
        .getByRole("link", { name: "Models & Products", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("link", { name: "Latest", exact: true }),
    ).not.toHaveAttribute("aria-current");
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(destination.url);
  });
}

for (const width of [320, 768, 1440]) {
  for (const scale of [1, 2]) {
    test(`top bar at ${width}px and ${scale * 100}% text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.addStyleTag({ content: `html { font-size: ${scale * 100}% !important; }` });
      await page.evaluate(() => document.fonts.ready);
      const header = page.getByRole("banner");
      const topics = header.locator("summary");
      const mobile = await topics.isVisible();
      const navigation = header.locator(mobile ? ".mobile-main-navigation" : ".header-navigation");
      const latest = navigation.locator('a[href="/"]');
      const about = navigation.locator('a[href="/about"]');
      if (mobile) {
        await expect(header.locator(".header-navigation")).toBeHidden();
        await expect(latest).toBeHidden();
        await expect(about).toBeHidden();
        await page.screenshot({ path: testInfo.outputPath("menu-closed.png") });
        await topics.click();
      }
      await expect(latest).toBeVisible();
      await expect(about).toBeVisible();
      await expect(latest).toHaveAttribute("aria-current", "page");
      await expect(about).not.toHaveAttribute("aria-current");
      await expect(
        page.locator(".topic-sidebar").getByRole("link", { name: /^(Latest|About)$/ }),
      ).toHaveCount(0);
      const controls = [header.getByRole("link", { name: "Hacksnap home" }), latest, about];
      if (await topics.isVisible()) controls.push(topics);
      const boxes = [];
      for (const control of controls) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        boxes.push(box);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (const other of boxes.slice(i + 1)) {
          const box = boxes[i];
          expect(
            box.x + box.width <= other.x ||
              other.x + other.width <= box.x ||
              box.y + box.height <= other.y ||
              other.y + other.height <= box.y,
          ).toBe(true);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: testInfo.outputPath("header.png") });
      await header.getByRole("link", { name: "Hacksnap home" }).focus();
      await page.keyboard.press("Tab");
      if (mobile) {
        await expect(topics).toBeFocused();
        await page.keyboard.press("Tab");
      }
      await expect(latest).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(about).toBeFocused();
      await expect(about).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/about$/);
      await expect(about).toHaveAttribute("aria-current", "page");
      await expect(latest).not.toHaveAttribute("aria-current");
      await page.goBack();
      await expect(latest).toHaveAttribute("aria-current", "page");
      await page.goForward();
      await expect(about).toHaveAttribute("aria-current", "page");
      if (mobile) {
        await expect(latest).toBeHidden();
        await topics.click();
      }
      await latest.click();
      await expect(page).toHaveURL(/\/$/);
      if (await topics.isVisible()) {
        await topics.click();
        const panel = page.getByRole("navigation", { name: "Mobile topics" });
        await expect(panel).toBeVisible();
        await expect(panel.getByRole("link", { name: /^(Latest|About)$/ })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.screenshot({ path: testInfo.outputPath("topics-open.png") });
      }
      expect(
        (
          await new AxeBuilder({ page })
            .include(".site-header")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
}

test("Latest clears the topic and closes an open mobile disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/?category=models-products");
  const latest = page.locator('.mobile-main-navigation a[href="/"]');
  await expect(latest).not.toHaveAttribute("aria-current");
  await page.locator(".menu-button").click();
  const topics = page.getByRole("navigation", { name: "Mobile topics" });
  await expect(topics).toBeVisible();
  await latest.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(topics).not.toBeVisible();
  await expect(latest).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(latest).not.toHaveAttribute("aria-current");
  await page.locator(".menu-button").click();
  await expect(topics.getByRole("link", { name: "Models & Products" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
