import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowseLoading } from "../app/browse-loading";

test("browse fallback announces progress once and keeps decorative cards out of the accessibility tree", () => {
  const html = renderToStaticMarkup(<BrowseLoading />);
  assert.match(html, /<p role="status" aria-live="polite"[^>]*>Loading stories…<\/p>/);
  assert.match(html, /<ol class="story-list" aria-hidden="true" aria-busy="true">/);
  assert.equal((html.match(/<article class="story-row feed-story">/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<(?:a|button|input)\b/);
});
