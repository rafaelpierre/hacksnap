import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const title = "Small models make local tools more useful";
export const storyPath = "/story/91000001";
export const test = base.extend<{ browserErrors: string[]; expectedNetworkErrors: boolean }>({
  expectedNetworkErrors: [false, { option: true }],
  browserErrors: [
    async ({ page, context, baseURL, expectedNetworkErrors }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !(
            expectedNetworkErrors &&
            /Failed to load resource.*503/.test(message.text()) &&
            message.location().url.includes("/api/ready-stories")
          )
        )
          errors.push(message.text());
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        // Serve generated, size-specific fixture bytes through the real Image URLs.
        // This exercises browser srcset selection without contacting Blob storage.
        if (url.origin === baseURL && url.pathname === "/_next/image") {
          const width = url.searchParams.get("w");
          if (!/^(128|256|320|384|640|750|1080|1600)$/.test(width ?? ""))
            throw new Error(`Unexpected optimizer width ${width}`);
          await route.fulfill({
            contentType: "image/webp",
            body: await readFile(path.resolve(`.browser-app/public/browser-images/${width}.webp`)),
          });
        } else if (url.origin === baseURL) await route.continue();
        else if (url.hostname === "www.googletagmanager.com")
          await route.fulfill({ contentType: "application/javascript", body: "" });
        else {
          errors.push(`Unexpected external request: ${url.origin}${url.pathname}`);
          await route.abort();
        }
      });
      await use(errors);
      expect(errors, "Browser console, hydration, and external-request errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
