import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

test("loading cards keep the shared title, excerpt, image order", () => {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const dom = new JSDOM(renderToStaticMarkup(<BrowseLoading />));
  try {
    const cards = dom.window.document.querySelectorAll("article.feed-story");
    assert.equal(cards.length, 3);
    for (const card of cards) {
      const children = Array.from(card.children) as Element[];
      assert.equal(children.length, 5);
      assert.ok(children[0]?.classList.contains("story-context"));
      assert.equal(children[1]?.tagName, "H2");
      assert.equal(children[2]?.tagName, "P");
      assert.ok(children[3]?.classList.contains("feed-story-image"));
      assert.ok(children[4]?.classList.contains("story-content"));
      assert.equal(card.querySelector(".story-content .feed-story-title"), null);
    }
  } finally {
    dom.window.close();
  }
});
