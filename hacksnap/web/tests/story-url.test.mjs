import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { canonicalStoryUrl, storyPath, storyIdFromSlug } from "../lib/story-url.ts";

test("only a saved slug changes the public address", () => {
  for (const slug of [undefined, null, "", "Headline", "another-story-124", "../headline-123"]) {
    assert.equal(storyPath("123", slug), "/story/123");
    assert.equal(canonicalStoryUrl("123", slug), "https://hacksnap.live/story/123");
  }
  assert.equal(storyPath("123", "original-title-123"), "/story/original-title-123");
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
