import assert from "node:assert/strict";
import { test } from "node:test";
import { renderRSS } from "../lib/rss.ts";

const story = {
  hn_id: "123", title: 'AI & <tools> "today" 🚀\u0000\ud800',
  date_added: new Date("2026-09-19T12:00:00Z"),
  summary: {
    overall_takeaway: "A & B", article_summary: "An <article>",
    discussion_summary: "Discuss ]]> safely",
  },
};

test("RSS escapes external text, preserves Unicode, and excludes invalid XML characters", () => {
  const rss = renderRSS([story]);
  assert.ok(rss.includes('AI &amp; &lt;tools&gt; &quot;today&quot; 🚀'));
  assert.ok(!rss.includes('\u0000'));
  assert.ok(!rss.includes('\ud800'));
  assert.ok(rss.includes('A &amp; B\n\nAn &lt;article&gt;\n\nDiscuss ]]&gt; safely'));
  assert.ok(rss.includes('<guid isPermaLink="true">https://hacksnap.live/story/123</guid>'));
  assert.ok(rss.includes('<pubDate>Sat, 19 Sep 2026 12:00:00 GMT</pubDate>'));
});

test("summary updates preserve item identity and publication date", () => {
  const before = renderRSS([{...story, summary: null}]);
  const after = renderRSS([story]);
  assert.ok(before.includes("Summary pending."));
  for (const tag of ["guid", "pubDate"]) {
    const pattern = new RegExp(`<${tag}[^>]*>.*?</${tag}>`);
    assert.equal(before.match(pattern)[0], after.match(pattern)[0]);
  }
  assert.equal(renderRSS([]).includes('<item>'), false);
  assert.ok(renderRSS([]).includes('<channel>'));
});
