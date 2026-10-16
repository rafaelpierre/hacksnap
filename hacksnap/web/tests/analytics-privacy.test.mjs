import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { analyticsBrowser } from "./analytics-browser.mjs";
import { createActiveClock } from "../lib/analytics-page.ts";
import {
  maskReplayAttribute,
  publicAnalyticsURL,
  scrubAnalyticsProperties,
  referrerOrigin,
} from "../lib/analytics-privacy.ts";
import {
  startJourneyTracking,
  track,
  prepareFeedLoadOutcome,
  captureReadingVisit,
} from "../lib/analytics.ts";
import { setAnalyticsConsent } from "../lib/analytics-consent.ts";

test("active time counts foreground time only and stops 60 seconds after input", () => {
  const clock = createActiveClock(0);
  assert.equal(clock.update(15_000, true), 15);
  assert.equal(clock.update(30_000, false), 30);
  assert.equal(clock.update(90_000, true, true), 30);
  assert.equal(clock.update(105_000, true), 45);
  assert.equal(clock.update(200_000, true), 90);
  assert.equal(clock.update(300_000, true), 90);
  assert.equal(clock.update(300_000, true, true), 90);
  assert.equal(clock.update(315_000, true), 105);
});

test("event and replay URLs are scrubbed independently, including nested SDK fields", () => {
  const secret = "https://hacksnap.live/story/42?draft=PRIVATE#PRIVATE";
  const safe = scrubAnalyticsProperties({
    $current_url: secret,
    $initial_current_url: secret,
    $session_entry_url: secret,
    $referrer: "https://example.com/private?email=PRIVATE",
    $pathname: "/story/42?draft=PRIVATE",
    $elements: [{ attr__href: secret, $el_text: "PRIVATE", tag_name: "a" }],
    title: "PRIVATE",
    utm_campaign: "PRIVATE",
    nested: { href: secret },
    $heatmap_data: {
      [secret]: [{ x: 10, y: 20 }],
      "https://hacksnap.live/2026/09?draft=PRIVATE": [{ x: 20, y: 30 }],
    },
  });
  assert.equal(JSON.stringify(safe).includes("PRIVATE"), false);
  assert.equal(safe.$current_url, "https://hacksnap.live/story/42");
  assert.equal(safe.$referrer, "https://example.com");
  assert.deepEqual(safe.$heatmap_data, { "https://hacksnap.live/story/42": [{ x: 10, y: 20 }] });
  assert.equal(referrerOrigin(""), "");
  assert.equal(publicAnalyticsURL("javascript:PRIVATE"), "");
  assert.equal(maskReplayAttribute("href", secret), "https://hacksnap.live/story/42");
  assert.equal(maskReplayAttribute("value", "PRIVATE"), "");
  assert.equal(maskReplayAttribute("data-draft", "PRIVATE"), "");
});

test("acceptance records the current story once and never repeats first-party popularity views", () => {
  const close = analyticsBrowser("https://hacksnap.live/story/42", "declined");
  const events = [],
    popularity = [];
  window.gtag = (_command, name, props) => events.push({ name, ...props });
  window.fetch = async (_url, options) => {
    popularity.push(JSON.parse(options.body));
    return {};
  };
  const stop = startJourneyTracking();
  try {
    track("story_view", { story_id: "42" }, "story:42");
    assert.equal(events.length, 0);
    assert.equal(popularity.length, 1);
    setAnalyticsConsent("accepted");
    setAnalyticsConsent("accepted");
    assert.equal(events.filter((e) => e.name === "page_view").length, 1);
    assert.equal(events.filter((e) => e.name === "story_view").length, 1);
    assert.equal(popularity.length, 1);
    setAnalyticsConsent("declined");
    track("story_view", { story_id: "42" }, "story:42");
    setAnalyticsConsent("accepted");
    assert.equal(events.filter((e) => e.name === "story_view").length, 2);
    assert.equal(popularity.length, 1);
  } finally {
    stop();
    close();
  }
});

test("feed outcomes settle once, distinguish cancellation and cannot cross consent epochs", () => {
  const close = analyticsBrowser();
  const events = [];
  window.gtag = (_command, name, props) => events.push({ name, ...props });
  const stop = startJourneyTracking();
  try {
    track("reader_visit", {}, "visit");
    const report = prepareFeedLoadOutcome();
    report({ outcome: "cancelled", trigger: "auto" });
    report({ outcome: "failure", trigger: "auto" });
    assert.deepEqual(
      events.filter((e) => e.name === "feed_load").map((e) => e.outcome),
      ["cancelled"],
    );
    const stale = prepareFeedLoadOutcome();
    setAnalyticsConsent("declined");
    setAnalyticsConsent("accepted");
    stale({ outcome: "success", loaded_count: 20 });
    assert.equal(events.filter((e) => e.name === "feed_load").length, 1);
  } finally {
    stop();
    close();
  }
});

test("article checkpoints preserve the source URL and cannot survive withdrawal", () => {
  const close = analyticsBrowser("https://hacksnap.live/story/42?draft=PRIVATE", "declined");
  const events = [];
  window.gtag = (_command, name, fields) => events.push({ name, ...fields });
  const context = {
    story_id: "42",
    reading_version: 1,
    content_revision: "fixture",
    layout_variant: "article-2026-10",
    copy_variant: "published",
    category: "models_products",
    summary_status: "ready",
  };
  const stop = startJourneyTracking();
  try {
    assert.equal(captureReadingVisit(context), null);
    setAnalyticsConsent("accepted");
    const source = captureReadingVisit(context);
    window.history.pushState({}, "", "/story/43");
    track("story_view", { story_id: "43" }, "story:43");
    source.emit("article_reading_checkpoint", { active_ms: 1000 });
    const checkpoint = events.at(-1);
    assert.equal(checkpoint.visit_id, source.visitId);
    assert.equal(checkpoint.$current_url, "https://hacksnap.live/story/42");
    assert.equal(checkpoint.page_location, "https://hacksnap.live/story/42");
    setAnalyticsConsent("declined");
    setAnalyticsConsent("accepted");
    const count = events.length;
    source.emit("article_reading_checkpoint", { active_ms: 2000 });
    assert.equal(events.length, count);
  } finally {
    stop();
    close();
  }
});
