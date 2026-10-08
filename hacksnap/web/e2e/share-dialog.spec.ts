import AxeBuilder from "@axe-core/playwright";
import { test, expect, storyPath, title } from "./browser";

for (const width of [320, 1280]) {
  test(`share dialog contains focus and preserves a failed-copy draft at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) },
      });
    });
    await page.goto(storyPath);
    if (width === 320) {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
    }
    const share = page.getByRole("button", { name: `Share: ${title}`, exact: true }).first();
    await share.click();
    const dialog = page.getByRole("dialog", { name: "Share this story", exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => node.matches(":modal"))).toBe(true);
    await expect(dialog).toContainText(title);
    const heading = dialog.getByRole("heading", { name: "Share this story", exact: true });
    const headingBounds = await heading.boundingBox();
    expect(headingBounds!.width).toBeGreaterThanOrEqual(140);
    expect(headingBounds!.height).toBeLessThan(260);
    const draft = dialog.getByRole("textbox", { name: "Suggested post", exact: true });
    const edited = "My edited take.\n\nhttps://hacksnap.live/story/91000001";
    await draft.fill(edited);
    await dialog.getByRole("button", { name: "Copy suggested post", exact: true }).click();
    const manual = dialog.getByRole("textbox", { name: "Text for manual copy" });
    await expect(manual).toBeFocused();
    await expect(manual).toHaveValue(edited);
    expect(
      await manual.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart),
    ).toBe(edited.length);
    const close = dialog.getByRole("button", { name: "Close share dialog" });
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(manual).toBeFocused();
    await share.evaluate((node: HTMLButtonElement) => node.focus());
    await expect(manual).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(bounds!.height).toBeLessThanOrEqual(900);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await manual.scrollIntoViewIfNeeded();
    await expect(manual).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`share-dialog-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(share).toBeFocused();
    await share.click();
    await expect(draft).toHaveValue(edited);
    await close.click();
    await expect(share).toBeFocused();
    await share.click();
    await page.mouse.click(1, 1);
    await expect(dialog).toHaveCount(0);
    await expect(share).toBeFocused();
  });
}

for (const width of [320, 1280]) {
  test(`home card shares its canonical URL and returns keyboard focus at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) => {
            document.documentElement.dataset.copied = value;
            return Promise.resolve();
          },
        },
      });
    });
    await page.goto("/");
    const card = page.locator(".feed-story").first();
    const path = await card.locator(".feed-story-title a").getAttribute("href");
    const share = card.getByRole("button", { name: /^Share:/ });
    await share.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Share this story", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-copied",
      `https://hacksnap.live${path}`,
    );
    await expect(dialog.getByRole("status")).toHaveText("Link copied to clipboard.");
    await page.keyboard.press("Escape");
    await expect(share).toBeFocused();
    if (width === 320)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
    await card.locator(".feed-story-rail").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("home-rail.png") });
  });
}
