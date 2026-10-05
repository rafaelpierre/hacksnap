import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { browseLabel, validBrowseContext } from "../lib/navigation-context.ts";

test("browse context retains list selection and page", () => {
  assert.equal(browseLabel("/"), "Latest stories");
  assert.equal(browseLabel("/?page=2"), "Latest stories · page 2");
  assert.equal(browseLabel("/?page=1"), "Latest stories");
  assert.equal(browseLabel("/?page=3"), "Latest stories · page 3");
  assert.equal(browseLabel("/2026/09?page=2"), "September 2026 archive · page 2");
  assert.equal(browseLabel("/?category=agents-coding&page=4"), "Agents & Coding · page 4");
});

test("return destination must be a recent internal browse route", () => {
  const now = Date.now();
  const context = {
    url: "/2026/09?page=2",
    label: "September 2026 archive · page 2",
    scrollY: 820,
    savedAt: now,
  };
  assert.deepEqual(validBrowseContext(context, now), context);
  assert.equal(validBrowseContext({ ...context, savedAt: now - 9 * 60 * 60 * 1000 }, now), null);
  assert.equal(validBrowseContext({ ...context, scrollY: -1 }, now), null);
  assert.equal(validBrowseContext({ ...context, label: "Top stories" }, now), null);
  for (const url of [
    "/?cursor=frozen_123",
    "/?page=2&cursor=frozen_123",
    "/?page=101",
    "/2026/09?page=101",
    "/category/agents-coding?page=101",
    "/archive",
    "/archive/2026/09",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/story/123",
    "/archive?next=https://evil.example",
    "/?cursor=frozen_123",
    "/?page=2&cursor=unsafe!",
    "/2026/13",
    "/category/unknown",
    "/?category=unknown",
    "/?category=",
    "/?category=agents-coding&category=models-products",
    "/2026/09?category=agents-coding",
  ]) {
    assert.equal(browseLabel(url), null, url);
    assert.equal(validBrowseContext({ ...context, url }, now), null, url);
  }
});

test("saved legacy category journeys migrate to filtered Latest without losing position or age", () => {
  const now = Date.now();
  const legacy = {
    url: "/category/agents-coding?page=4",
    label: "Agents & Coding · page 4",
    scrollY: 1930,
    savedAt: now - 60000,
  };
  assert.deepEqual(validBrowseContext(legacy, now), {
    ...legacy,
    url: "/?category=agents-coding&page=4",
  });
  assert.equal(validBrowseContext({ ...legacy, savedAt: now - 9 * 3600000 }, now), null);
  assert.equal(validBrowseContext({ ...legacy, url: "/category/unknown?page=4" }, now), null);
  assert.equal(
    validBrowseContext({ ...legacy, url: "/category/agents-coding?page=4&page=5" }, now),
    null,
  );
});
