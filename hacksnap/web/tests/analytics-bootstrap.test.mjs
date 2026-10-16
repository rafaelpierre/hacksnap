import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { analyticsBrowser } from "./analytics-browser.mjs";

test("PostHog requires the enabled switch, public token and EU host", async () => {
  const keys = [
    "NEXT_PUBLIC_POSTHOG_ENABLED",
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
    "NEXT_PUBLIC_POSTHOG_HOST",
  ];
  const before = keys.map((key) => process.env[key]);
  const { posthogConfigured } = await import("../lib/analytics-vendors.ts");
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(posthogConfigured(), false);
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_dummy";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
    assert.equal(posthogConfigured(), true);
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "false";
    assert.equal(posthogConfigured(), false);
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://example.com";
    assert.equal(posthogConfigured(), false);
  } finally {
    keys.forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    });
  }
});

test("both vendors stay silent before consent; withdrawal clears queued events and identifiers", async () => {
  const close = analyticsBrowser("https://hacksnap.live/story/42?draft=private#secret", null);
  jest.resetModules();
  const consent = await import("../lib/analytics-consent.ts");
  const runtime = await import("../lib/analytics-vendors.ts");
  try {
    runtime.installAnalyticsRuntime();
    runtime.notifyAnalyticsReady();
    runtime.captureVendorEvent("story_view", { story_id: "42" });
    window.dispatchEvent(new window.Event("pointerdown"));
    assert.equal(window.dataLayer.length, 0);
    assert.equal(document.scripts.length, 0);
    consent.setAnalyticsConsent("declined");
    runtime.captureVendorEvent("story_view", { story_id: "42" });
    assert.equal(window.dataLayer.length, 0);
    consent.setAnalyticsConsent("accepted");
    runtime.captureVendorEvent("story_view", { story_id: "42" });
    assert.equal(window.dataLayer.filter((args) => args[1] === "story_view").length, 1);
    assert.equal(JSON.stringify(window.dataLayer).includes("private"), false);
    assert.equal(document.scripts.length, 1);
    window.dispatchEvent(new window.Event("keydown"));
    assert.equal(document.scripts.length, 1);
    const queued = window.dataLayer;
    localStorage.setItem("ph_test", "identifier");
    localStorage.setItem("hacksnap:story-history", "functional");
    document.cookie = "_ga=identifier; path=/";
    consent.setAnalyticsConsent("declined");
    assert.equal(queued.length, 0);
    assert.equal(localStorage.getItem("ph_test"), null);
    assert.equal(localStorage.getItem("hacksnap:story-history"), "functional");
    assert.equal(document.cookie.includes("_ga="), false);
    assert.equal(window["ga-disable-G-059PVYBN82"], true);
    assert.equal(document.scripts.length, 0);
  } finally {
    close();
  }
});

test("cross-tab consent changes are observed, unavailable storage never grants consent", async () => {
  const close = analyticsBrowser(undefined, null);
  jest.resetModules();
  const { analyticsAllowed, setAnalyticsConsent, subscribeAnalyticsConsent } =
    await import("../lib/analytics-consent.ts");
  const changes = [];
  const unsubscribe = subscribeAnalyticsConsent(() => changes.push(analyticsAllowed()));
  try {
    localStorage.setItem("hacksnap:analytics-consent:v1", "accepted");
    window.dispatchEvent(
      new window.StorageEvent("storage", { key: "hacksnap:analytics-consent:v1" }),
    );
    localStorage.clear();
    window.dispatchEvent(new window.StorageEvent("storage", { key: null }));
    assert.deepEqual(changes, [true, false]);
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("blocked");
      },
    });
    assert.equal(setAnalyticsConsent("accepted"), false);
    assert.equal(analyticsAllowed(), false);
  } finally {
    unsubscribe();
    close();
  }
});
