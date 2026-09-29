import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { canonicalStoryUrl, storySlug, storyPath, storyIdFromSlug } from "../lib/story-url.ts";

test("headlines produce bounded, readable, unambiguous URLs", () => {
  assert.equal(storyPath("123", "Café’s AI: What's new?"), "/story/cafes-ai-whats-new-123");
  assert.equal(canonicalStoryUrl("123", "Headline"), "https://hacksnap.live/story/headline-123");
  assert.equal(storySlug("123", "🚀 中文"), "story-123");
  assert.equal(storySlug("123", ""), "story-123");
  assert.notEqual(storySlug("123", "Same title"), storySlug("124", "Same title"));
  for (const title of ["a".repeat(200), "long title ".repeat(30), "2026", "<script>/../?foo#bar"]) {
    const slug = storySlug("999999999999999", title);
    assert.ok(slug.length <= 96);
    assert.equal(storyIdFromSlug(slug), "999999999999999");
  }
});

test("old IDs and edited titles resolve while malformed routes are rejected", () => {
  for (const slug of ["123", "headline-123", "old-headline-123", "2026-123"]) {
    assert.equal(storyIdFromSlug(slug), "123");
  }
  for (const slug of [
    "",
    "0",
    "01",
    "-1",
    "headline",
    "headline-0",
    "headline-01",
    "Headline-123",
    "x--123",
    "x/123",
    "x-123?foo",
    "x-123\n",
    "x-%31",
    "1234567890123456",
    "x-1234567890123456",
    `${"a".repeat(81)}-999999999999999`,
  ]) {
    assert.equal(storyIdFromSlug(slug), null, slug);
  }
});
