import { test, expect, title, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1280])
  for (const textScale of [1, 2]) {
    test(`${width}px ${textScale * 100}% text: layout and responsive image`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/",
        "/2026/01",
        "/?category=models-products",
        "/?category=safety-privacy",
        "/topics",
        "/about",
        storyPath,
      ]) {
        await page.goto(route);
        await expect(page.locator(".menu-button")).toHaveAttribute("aria-expanded", "false");
        // Keep the simulated user stylesheet outside Next's managed head.
        await page.locator("body").evaluate((body, scale) => {
          const style = document.createElement("style");
          style.textContent = `html { font-size: ${scale * 100}% !important; }`;
          body.appendChild(style);
        }, textScale);
        await expect(page.locator("html")).toHaveCSS("font-size", `${16 * textScale}px`);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const latest = route === "/" || route.startsWith("/?category=");
        if (latest) await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
        else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if ((latest && route !== "/?category=safety-privacy") || route === "/2026/01") {
          await expect(page.locator(".story-list .category-badge").first()).toBeVisible();
        }
        if (latest) await expect(page.locator("section > .feed-bar time")).toHaveCount(0);
        const layout = await page.evaluate(() => ({
          viewport: window.innerWidth,
          content: document.documentElement.scrollWidth,
          scheme: getComputedStyle(document.documentElement).colorScheme,
          rootFont: getComputedStyle(document.documentElement).fontSize,
          hiddenImages: [...document.images].filter(
            (image) =>
              image.getBoundingClientRect().width > 0 && image.complete && image.naturalWidth === 0,
          ).length,
        }));
        expect(layout.content, "No horizontal overflow").toBeLessThanOrEqual(layout.viewport + 1);
        await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 244, 245)");
        await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 244, 245)");
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
          "content",
          "#ffffff",
        );
        expect(layout.scheme.split(" ").sort()).toEqual(["light", "only"]);
        await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toHaveCount(0);
        if (!latest)
          await expect
            .poll(
              () =>
                page
                  .getByRole("heading", { level: 1 })
                  .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
              { message: `${route} with root font ${layout.rootFont}` },
            )
            .toBeGreaterThanOrEqual(textScale === 2 ? 40 : 24);
        expect(layout.hiddenImages).toBe(0);
        if (["/", "/2026/01", "/?category=models-products", storyPath].includes(route)) {
          const image = page.locator("main img").first();
          await expect(image).toBeVisible();
          const selected = await image.evaluate((node) => ({
            src: (node as HTMLImageElement).currentSrc,
            width: node.getBoundingClientRect().width,
            naturalWidth: (node as HTMLImageElement).naturalWidth,
          }));
          expect(selected.naturalWidth).toBeGreaterThan(0);
          expect(Number(new URL(selected.src).searchParams.get("w"))).toBeLessThanOrEqual(
            width === 320 ? 640 : 1080,
          );
        }
        if (["/", "/2026/01", "/?category=models-products"].includes(route)) {
          const card = page.locator(".feed-story").first();
          const headline = await card.locator(".feed-story-title").boundingBox();
          const excerpt = await card.locator(".feed-excerpt").boundingBox();
          const image = await card.locator(".feed-story-image").boundingBox();
          expect(excerpt!.y, "Subtitle follows the headline").toBeGreaterThanOrEqual(
            headline!.y + headline!.height,
          );
          expect(image!.y, "Image follows the subtitle").toBeGreaterThanOrEqual(
            excerpt!.y + excerpt!.height,
          );
        }
        const header = await page.getByRole("banner").boundingBox();
        const firstContent = await (
          latest
            ? route === "/?category=safety-privacy"
              ? page.getByRole("heading", { name: "No stories in this topic yet.", exact: true })
              : page.locator(".story-list > li").first()
            : page.getByRole("heading", { level: 1 })
        ).boundingBox();
        expect(firstContent!.y, "Content follows the normal-flow header").toBeGreaterThanOrEqual(
          header!.y + header!.height,
        );
        if (["/about", storyPath].includes(route))
          expect(firstContent!.width, "Reading column stays bounded").toBeLessThanOrEqual(
            Math.min(width, 736 * textScale),
          );
        // Structural assertions are stable across OS font rasterizers. Retain the
        // complete image for manual visual review; no pixel baseline is auto-updated.
        const slug = route === "/" ? "home" : route.replace(/[^a-z0-9-]/gi, "-");
        await page.screenshot({
          path: testInfo.outputPath(`${slug}.png`),
          fullPage: false,
          animations: "disabled",
        });
        expect(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
            .violations,
        ).toEqual([]);
      }
      const share = page.getByRole("button", { name: `Share: ${title}`, exact: true }).first();
      await share.click();
      const panel = page.getByRole("dialog", { name: "Share this story", exact: true });
      await expect(panel).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Suggested post", exact: true }),
      ).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: testInfo.outputPath("share-open.png"),
        animations: "disabled",
      });
    });
  }

for (const touch of [false, true]) {
  test.describe(touch ? "touch background" : "mouse background", () => {
    test.use({ hasTouch: touch });

    test("story hover respects the primary input device", async ({ page }) => {
      await page.setViewportSize({ width: touch ? 320 : 1280, height: 900 });
      await page.goto("/");
      const story = page.locator(".story-row").first();
      await story.hover();
      await expect(story).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 244, 245)");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 244, 245)");
    });
  });
}
