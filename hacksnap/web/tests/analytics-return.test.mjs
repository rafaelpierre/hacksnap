import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "@jest/globals";
import { copyShareText, recordVisit, track, trackOnce } from "../lib/analytics.ts";
import { observeRecommendationExposure } from "../lib/recommendation-exposure.ts";

import { analyticsBrowser } from "./analytics-browser.mjs";
let close;
beforeEach(() => {
  close = analyticsBrowser();
});
afterEach(() => close());

test("story events deduplicate within a tracking session and remain nonblocking without GA", () => {
  const calls = [];
  window.gtag = (...args) => calls.push(args);
  trackOnce("story:1", { name: "story_view", story_id: "1" });
  trackOnce("story:1", { name: "story_view", story_id: "1" });
  trackOnce("story:2", { name: "story_view", story_id: "2" });
  assert.deepEqual(
    calls.filter((call) => call[1] === "story_view").map((call) => call[2].story_id),
    ["1", "2"],
  );
  delete window.gtag;
  assert.doesNotThrow(() => track({ name: "story_view", story_id: "3" }));
  assert.equal(window.dataLayer.at(-1)[1], "story_view");
  assert.equal(window.dataLayer.at(-1)[2].story_id, "3");
});

test("intervening same-day loads do not move the return-visit anchor", () => {
  const calls = [];
  window.gtag = (...args) => calls.push(args);
  const day = 86_400_000;
  const start = Date.now() - 3 * day;
  recordVisit(start);
  recordVisit(start + day / 2);
  assert.equal(localStorage.getItem("hacksnap:visit-anchor"), String(start));
  assert.equal(calls.length, 0);
  recordVisit(start + day * 1.25);
  recordVisit(start + day * 1.25);
  assert.equal(calls.filter((call) => call[1] === "return_visit").length, 1);
  const returned = calls.find((call) => call[1] === "return_visit");
  assert.equal(returned[2].days_since_visit_anchor, 1);
  assert.equal(localStorage.getItem("hacksnap:visit-anchor"), String(start + day * 1.25));
});

test("blocked storage and analytics do not interrupt site actions", () => {
  globalThis.window = {
    location: { pathname: `/test/${Math.random()}` },
    gtag: () => {
      throw Error("blocked");
    },
  };
  globalThis.localStorage = {
    getItem: () => {
      throw Error("blocked");
    },
  };
  globalThis.sessionStorage = {
    getItem: () => {
      throw Error("blocked");
    },
  };
  assert.doesNotThrow(() => recordVisit());
  assert.doesNotThrow(() => trackOnce("story:1", { name: "story_view", story_id: "1" }));
});

test("copy reports success only after a resolved clipboard write and failure offers fallback", async () => {
  const calls = [];
  window.gtag = (...args) => calls.push(args);
  const success = await copyShareText(
    "editable suggestion",
    "42",
    "story_end",
    "post",
    async (value) => {
      assert.equal(value, "editable suggestion");
    },
  );
  const failure = await copyShareText(
    "editable suggestion",
    "42",
    "story_end",
    "post",
    async () => {
      throw Error("permission denied");
    },
  );
  assert.equal(success, true);
  assert.equal(failure, false);
  assert.deepEqual(
    calls.filter((call) => !["reader_visit", "page_view"].includes(call[1])).map((call) => call[1]),
    [
      "share_copy_attempt",
      "share_copy_success",
      "share_copy_attempt",
      "share_copy_failure",
      "share_manual_fallback",
    ],
  );
  assert.ok(calls.every((call) => !Object.values(call[2]).includes("editable suggestion")));
  await copyShareText("https://hacksnap.live/story/42", "42", "feed", "link", async () => {});
  assert.equal(calls.at(-1)[2].copy_kind, "link");
});

test("recommendation exposure waits until half the link is visible", () => {
  let callback;
  let disconnects = 0;
  let observed;
  class FakeObserver {
    constructor(receive, options) {
      callback = receive;
      assert.equal(options.threshold, 0.5);
    }
    observe(element) {
      observed = element;
    }
    disconnect() {
      disconnects++;
    }
  }
  const element = {};
  let exposures = 0;
  observeRecommendationExposure(
    element,
    () => {
      exposures++;
    },
    FakeObserver,
  );
  assert.equal(observed, element);
  callback([{ isIntersecting: true, intersectionRatio: 0.01 }]);
  assert.equal(exposures, 0);
  assert.equal(disconnects, 0);
  callback([{ isIntersecting: true, intersectionRatio: 0.5 }]);
  assert.equal(exposures, 1);
  assert.equal(disconnects, 1);
});
