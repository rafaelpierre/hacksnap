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
      await context.addInitScript(() => {
        try {
          if (!localStorage.getItem("hacksnap:analytics-consent:v1"))
            localStorage.setItem("hacksnap:analytics-consent:v1", "declined");
        } catch {
          /* Some tests deliberately block storage. */
        }
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !(
            expectedNetworkErrors &&
            ((/Failed to load resource.*503/.test(message.text()) &&
              message.location().url.includes("/api/browse-stories")) ||
              (/ERR_BLOCKED_BY_CLIENT/.test(message.text()) &&
                /^https:\/\/(eu|eu-assets)\.i\.posthog\.com\//.test(message.location().url)))
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
        } else if (
          route.request().method() === "HEAD" &&
          /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname) &&
          url.pathname.startsWith("/articles/")
        ) {
          await route.fulfill({
            headers: { "access-control-allow-origin": "*", "content-length": "50000" },
          });
        } else if (url.origin === baseURL) await route.continue();
        else if (url.hostname === "www.googletagmanager.com")
          await route.fulfill({ contentType: "application/javascript", body: "" });
        else if (["eu.i.posthog.com", "eu-assets.i.posthog.com"].includes(url.hostname)) {
          // All PostHog endpoints are local responses, including replay assets.
          // Never forward fixture traffic or its dummy project token to a vendor.
          if (
            [
              "recorder.js",
              "lazy-recorder.js",
              "web-vitals-with-attribution.js",
              "dead-clicks-autocapture.js",
            ].includes(path.basename(url.pathname))
          ) {
            await route.fulfill({
              contentType: "application/javascript",
              body: await readFile(
                path.resolve("node_modules/posthog-js/dist", path.basename(url.pathname)),
              ),
            });
          } else if (url.pathname.endsWith(".js")) {
            await route.fulfill({ contentType: "application/javascript", body: "" });
          } else if (url.pathname.startsWith("/flags") || url.pathname.includes("/config")) {
            await route.fulfill({
              json: {
                featureFlags: {},
                autocapture: true,
                heatmaps: true,
                sessionRecording: {
                  endpoint: "/s/",
                  sampleRate: 1,
                  minimumDurationMilliseconds: 0,
                  consoleLogRecordingEnabled: false,
                  networkPayloadCapture: { recordBody: false, recordHeaders: false },
                },
              },
            });
          } else await route.fulfill({ json: { status: 1 } });
        } else {
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
