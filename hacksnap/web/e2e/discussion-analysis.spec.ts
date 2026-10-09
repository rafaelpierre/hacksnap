import { test, expect, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1280])
  for (const textScale of [1, 2]) {
    test(`topic deep link: ${width}px ${textScale * 100}% text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${storyPath}#discussion-topic-evidence-1`);
      const topic = page.locator("#discussion-topic-evidence-1");
      const details = topic.locator("details");
      await expect(details).toHaveAttribute("open", "");
      await expect(page.locator("#discussion-topic-evidence-0 details")).not.toHaveAttribute(
        "open",
      );
      await expect(topic.locator("summary")).toBeInViewport();
      await expect(topic.locator(".analysis-theme-body")).toBeVisible();
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await topic.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("topic-deep-link.png") });
      await topic.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(details).not.toHaveAttribute("open");
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await page.reload();
      await expect(details).toHaveAttribute("open", "");
      await expect(topic.locator("summary")).toBeInViewport();
    });
  }

test("hash changes and Back/Forward reveal the selected topic", async ({ page }) => {
  await page.goto(storyPath);
  const first = page.locator("#discussion-topic-evidence-0 details");
  const second = page.locator("#discussion-topic-evidence-1 details");
  await expect(page.locator(".analysis-theme-details[open]")).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = "discussion-topic-evidence-0";
  });
  await expect(first).toHaveAttribute("open", "");
  await expect(second).not.toHaveAttribute("open");
  await first.locator("summary").click();
  await page.evaluate(() => {
    location.hash = "discussion-topic-evidence-1";
  });
  await expect(second).toHaveAttribute("open", "");
  await expect(first).not.toHaveAttribute("open");
  await second.locator("summary").click();
  await page.goBack();
  await expect(first).toHaveAttribute("open", "");
  await expect(second).not.toHaveAttribute("open");
  await page.goForward();
  await expect(second).toHaveAttribute("open", "");
  await expect(first).toHaveAttribute("open", "");
});

for (const hash of ["discussion-topic-missing-99", "discussion-analysis", "%E0%A4%A"])
  test(`unmatched fragment leaves topics collapsed: ${hash}`, async ({ page }) => {
    await page.goto(`${storyPath}#${hash}`);
    await expect(page.locator(".analysis-theme-details")).toHaveCount(2);
    await expect(page.locator(".analysis-theme-details[open]")).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = "discussion-topic-%65vidence-1";
    });
    await expect(page.locator("#discussion-topic-evidence-1 details")).toHaveAttribute("open", "");
  });

for (const width of [320, 1280])
  for (const textScale of [1, 2]) {
    test(`analysis information: ${width}px ${textScale * 100}% text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(storyPath);
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
      await page.locator("#discussion-analysis").scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("heading", { name: "Discussion analysis", exact: true }),
      ).toBeVisible();
      const headingBounds = await page
        .getByRole("heading", { name: "Discussion analysis", exact: true })
        .boundingBox();
      expect(headingBounds!.width).toBeGreaterThanOrEqual(140);
      expect(headingBounds!.height).toBeLessThan(320);
      const trigger = page.getByRole("button", { name: "About this discussion analysis" });
      const popup = page.getByRole("dialog", { name: "Analysis details" });
      await trigger.scrollIntoViewIfNeeded();
      await expect(page.locator(".analysis-coverage")).not.toBeVisible();
      await expect(page.getByRole("link", { name: /Read the full HN discussion/ })).toHaveCount(0);
      const target = await trigger.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath("analysis-closed.png") });
      await trigger.click();
      await expect(popup).toBeVisible();
      await expect(popup).toContainText("12 comments analyzed.");
      await expect(popup).toContainText("12 of 30 usable stored comments");
      await expect(page.getByRole("button", { name: "Close analysis information" })).toBeFocused();
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("analysis-open.png") });
      await page.keyboard.press("Escape");
      await expect(popup).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(popup).toBeVisible();
      await page.getByRole("button", { name: "Close analysis information" }).click();
      await expect(popup).not.toBeVisible();
      await trigger.click();
      await page.mouse.click(1, bounds!.y + 10);
      await expect(popup).not.toBeVisible();
      await page
        .locator(".analysis-theme-details > summary")
        .filter({ hasText: "Measuring useful work" })
        .click();
      await page.getByRole("button", { name: "Source comments for Measuring useful work" }).click();
      await expect(
        page.getByRole("dialog", { name: "Source comments", exact: true }),
      ).toBeVisible();
      await expect(popup).not.toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    });
  }

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("analysis information disclosure still opens and closes", async ({ page }) => {
    await page.goto(storyPath);
    const popup = page.getByRole("dialog", { name: "Analysis details" });
    await expect(page.locator(".analysis-coverage")).not.toBeVisible();
    await page.getByRole("button", { name: "About this discussion analysis" }).click();
    await expect(popup).toBeVisible();
    await page.getByRole("button", { name: "Close analysis information" }).click();
    await expect(popup).not.toBeVisible();
  });

  test("topic deep links retain a usable native disclosure", async ({ page }) => {
    await page.goto(`${storyPath}#discussion-topic-evidence-1`);
    const topic = page.locator("#discussion-topic-evidence-1");
    await expect(topic.locator("summary")).toBeInViewport();
    await topic.locator("summary").click();
    await expect(topic.locator("details")).toHaveAttribute("open", "");
    await expect(topic.locator(".analysis-theme-body")).toBeVisible();
  });
});
