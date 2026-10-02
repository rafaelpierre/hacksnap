import { test, expect, title, storyPath } from "./browser";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1280])
  for (const theme of ["light", "dark"] as const)
    for (const textScale of [1, 2]) {
      test(`${width}px ${theme} ${textScale * 100}% text: layout and responsive image`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        for (const route of [
          "/",
          "/archive",
          "/category/models-products",
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
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
          expect(layout.scheme).toContain(theme);
          expect(parseFloat(layout.heading)).toBeGreaterThanOrEqual(textScale === 2 ? 40 : 24);
          expect(layout.hiddenImages).toBe(0);
          if (["/", "/archive", "/category/models-products", storyPath].includes(route)) {
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
          const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
          expect(heading!.y, "Heading clears the sticky header").toBeGreaterThanOrEqual(
            header!.y + header!.height,
          );
          if (["/about", "/docs/api", storyPath].includes(route))
            expect(heading!.width, "Reading column stays bounded").toBeLessThanOrEqual(
              Math.min(width, 736 * textScale),
            );
          // Structural assertions are stable across OS font rasterizers. Retain the
          // complete image for manual visual review; no pixel baseline is auto-updated.
          const slug = route === "/" ? "home" : route.replaceAll("/", "-");
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
