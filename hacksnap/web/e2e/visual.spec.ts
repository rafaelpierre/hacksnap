import { test, expect, title, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1280])
  for (const systemScheme of ["light", "dark"] as const)
    for (const textScale of [1, 2]) {
      test(`${width}px ${systemScheme} OS ${textScale * 100}% text: layout and responsive image`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: systemScheme });
        await page.addInitScript(() => localStorage.setItem("hacksnap-theme", "dark"));
        for (const route of [
          "/",
          "/2026/01",
          "/?category=models-products",
          "/?category=safety-privacy",
          "/topics",
          "/about",
          "/docs/api",
          storyPath,
        ]) {
          await page.goto(route);
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = `${scale * 100}%`;
          }, textScale);
          await page.evaluate(() => document.fonts.ready);
          const latest = route === "/" || route.startsWith("/?category=");
          if (latest) await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
          else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          if (route.startsWith("/category/")) {
            await expect(page.locator(".story-list .category-badge")).toHaveCount(0);
            await expect(page.locator(".story-list .story-context")).toHaveCount(0);
          } else if (latest || route === "/2026/01") {
            await expect(page.locator(".story-list .category-badge").first()).toBeVisible();
          }
          if (latest) await expect(page.locator("section > .feed-bar time")).toHaveCount(0);
          const layout = await page.evaluate(() => ({
            viewport: window.innerWidth,
            content: document.documentElement.scrollWidth,
            scheme: getComputedStyle(document.documentElement).colorScheme,
            heading: getComputedStyle(document.querySelector("h1")!).fontSize,
            hiddenImages: [...document.images].filter(
              (image) =>
                image.getBoundingClientRect().width > 0 &&
                image.complete &&
                image.naturalWidth === 0,
            ).length,
          }));
          expect(layout.content, "No horizontal overflow").toBeLessThanOrEqual(layout.viewport + 1);
          await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
          expect(layout.scheme.split(" ").sort()).toEqual(["light", "only"]);
          await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toHaveCount(0);
          if (!latest)
            expect(parseFloat(layout.heading)).toBeGreaterThanOrEqual(textScale === 2 ? 40 : 24);
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
          const header = await page.getByRole("banner").boundingBox();
          const firstContent = await (
            latest
              ? route === "/?category=safety-privacy"
                ? page.locator("main .feed-bar").first()
                : page.locator(".story-list > li").first()
              : page.getByRole("heading", { level: 1 })
          ).boundingBox();
          expect(firstContent!.y, "Content clears the sticky header").toBeGreaterThanOrEqual(
            header!.y + header!.height,
          );
          if (["/about", "/docs/api", storyPath].includes(route))
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
        const panel = page.getByRole("region", { name: `Share ${title}`, exact: true });
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
