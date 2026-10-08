import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  globalTimeout: 240_000,
  fullyParallel: true,
  workers: process.env.CI ? "100%" : 4,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    { name: "chromium" },
    {
      name: "iphone-webkit",
      testMatch: "story-browser-history.spec.ts",
      use: { ...devices["iPhone 13"] },
    },
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${process.env.BROWSER_PORT ?? "3100"}`,
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run browser:start",
    url: `http://127.0.0.1:${process.env.BROWSER_PORT ?? "3100"}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
