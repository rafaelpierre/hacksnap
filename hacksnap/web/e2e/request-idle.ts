import { expect, type Page, type Request } from "@playwright/test";

// A previously reached networkidle load state can miss prefetches queued after a scroll.
export function trackRequests(page: Page): () => Promise<void> {
  const pending = new Set<Request>();
  let lastActivity = Date.now();
  const started = (request: Request) => {
    pending.add(request);
    lastActivity = Date.now();
  };
  const finished = (request: Request) => {
    pending.delete(request);
    lastActivity = Date.now();
  };
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  page.once("close", () => {
    page.off("request", started);
    page.off("requestfinished", finished);
    page.off("requestfailed", finished);
    pending.clear();
  });

  return async () => {
    const settleStarted = Date.now();
    await expect
      .poll(
        () => ({
          pending: pending.size,
          quiet: Date.now() - Math.max(settleStarted, lastActivity) >= 500,
        }),
        {
          message: "All requests finish before a fresh 500ms quiet period",
          timeout: 20_000,
          intervals: [50, 100, 250],
        },
      )
      .toEqual({ pending: 0, quiet: true });
  };
}
