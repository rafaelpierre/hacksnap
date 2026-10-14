import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleSummary, SummaryInline } from "../app/summary-text";
import { summaryBlocks, summaryMarkdown, summaryPlainText } from "../lib/summary-format";

const brief =
  "Researchers report **lower latency**. Costs remain uncertain.\n\n## Test conditions\n\nThe test used **one workload**.\n\n### Memory cost\n\nMemory doubled.";

test("summary headings, emphasis, paragraphs and the source link render together", () => {
  const html = renderToStaticMarkup(
    <ArticleSummary text={brief} sourceUrl="https://example.com" />,
  );
  assert.match(html, /<h2>Test conditions<\/h2>/);
  assert.match(html, /<h3>Memory cost<\/h3>/);
  assert.match(
    html,
    /<a href="https:\/\/example.com"[^>]*>Researchers report <strong>lower latency<\/strong><\/a>\./,
  );
  assert.match(html, /<strong>one workload<\/strong>/);
  assert.equal((html.match(/<p>/g) ?? []).length, 3);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.doesNotMatch(html, /\*\*|##|<strong><\/strong>/);
});

test("emphasis spanning sentences survives sentence spacing and opening links", () => {
  const html = renderToStaticMarkup(
    <ArticleSummary
      text="A **reported result. A caveat** follows."
      sourceUrl="https://example.com"
    />,
  );
  assert.match(html, /A <strong>reported result<\/strong><\/a><strong>\. <\/strong>/);
  assert.match(html, /<strong>A caveat<\/strong> follows\./);
});

test("only H2 and H3 are parsed, with orphan H3 promoted and CRLF normalized", () => {
  assert.deepEqual(
    summaryBlocks(
      "### First\r\nText\r\n\r\n## Second\r\n### Nested\r\n# Literal\r\n#### Literal too",
    ),
    [
      { kind: "h2", text: "First" },
      { kind: "paragraph", text: "Text" },
      { kind: "h2", text: "Second" },
      { kind: "h3", text: "Nested" },
      { kind: "paragraph", text: "# Literal #### Literal too" },
    ],
  );
});

test("untrusted HTML, links and unsupported or malformed Markdown stay inert", () => {
  const text =
    "**<script>alert(1)</script>** [link](javascript:alert(1)) ![image](https://example.com) <img src=x onerror=alert(1)> **unclosed *italic* `code`";
  const html = renderToStaticMarkup(<SummaryInline text={text} />);
  assert.match(html, /<strong>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/strong>/);
  assert.match(html, /\*\*unclosed \*italic\* `code`/);
  assert.doesNotMatch(html, /<script|<img|<a |<em>|<code>/);
  const exported = summaryMarkdown(`## Unsafe <title>\n\n${text}`);
  assert.match(exported, /^## Unsafe \\<title\\>/);
  assert.doesNotMatch(exported, /(?<!\\)(?:\[link\]|<script>|<img)/);
});

test("Markdown preserves allowed formatting while plain-text channels remove its markers", () => {
  assert.equal(
    summaryPlainText(brief),
    "Researchers report lower latency. Costs remain uncertain.\n\nTest conditions\n\nThe test used one workload.\n\nMemory cost\n\nMemory doubled.",
  );
  const markdown = summaryMarkdown(brief);
  assert.match(markdown, /\n\n## Test conditions\n\n/);
  assert.match(markdown, /\n\n### Memory cost\n\n/);
  assert.match(markdown, /\*\*lower latency\*\*/);
});
