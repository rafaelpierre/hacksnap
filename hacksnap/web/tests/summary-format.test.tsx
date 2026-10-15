import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleSummary, SummaryInline } from "../app/summary-text";
import {
  summaryMarkdown,
  summaryPlainText,
  summaryInlineText,
  summaryInlineMarkdown,
} from "../lib/summary-format";

const brief =
  "Researchers report **lower latency**. Costs remain uncertain.\n\n## Test conditions\n\nThe test used **one workload**.\n\n### Memory cost\n\nMemory doubled.";

test("paragraphs, headings and bold render without manufactured breaks or source links", () => {
  const html = renderToStaticMarkup(<ArticleSummary text={brief} />);
  assert.match(
    html,
    /<p>Researchers report <strong>lower latency<\/strong>\. Costs remain uncertain\.<\/p>/,
  );
  assert.match(html, /<h2>Test conditions<\/h2>/);
  assert.match(html, /<h3>Memory cost<\/h3>/);
  assert.equal((html.match(/<p>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<a |<br|<span|\*\*|##/);
});

test("emphasis can span sentences without being split", () => {
  assert.equal(
    renderToStaticMarkup(<SummaryInline text="A **reported result. A caveat** follows." />),
    "A <strong>reported result. A caveat</strong> follows.",
  );
});

test("inline summaries keep whitespace between paragraphs without block elements", () => {
  assert.equal(
    renderToStaticMarkup(<SummaryInline text={"First paragraph.\n\n**Second** paragraph."} />),
    "First paragraph. <strong>Second</strong> paragraph.",
  );
});

test("CommonMark links, nested emphasis, lists, quotes and code render semantically", () => {
  const text =
    "[A **strong** source](https://example.com/report_(v2)) with *emphasis* and `code`.\n\n- First\n- Second\n\n3. Third\n\n> A quotation.\n\n```js\nconst value = '<script>';\n```";
  const html = renderToStaticMarkup(<ArticleSummary text={text} />);
  assert.match(
    html,
    /<a href="https:\/\/example.com\/report_\(v2\)" target="_blank" rel="noopener noreferrer">A <strong>strong<\/strong> source<\/a>/,
  );
  assert.match(html, /<em>emphasis<\/em> and <code>code<\/code>/);
  assert.match(html, /<ul><li><p>First<\/p><\/li><li><p>Second<\/p><\/li><\/ul>/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<blockquote><p>A quotation\.<\/p><\/blockquote>/);
  assert.match(html, /<pre><code>const value = &#x27;&lt;script&gt;&#x27;;<\/code><\/pre>/);
});

test("only explicit Markdown hard breaks create br elements", () => {
  const html = renderToStaticMarkup(
    <ArticleSummary text={"First sentence.\nSecond sentence.  \nHard break.\n\nNew paragraph."} />,
  );
  assert.match(html, /First sentence\.\nSecond sentence\.<br\/>Hard break/);
  assert.equal((html.match(/<p>/g) ?? []).length, 2);
  assert.equal((html.match(/<br/g) ?? []).length, 1);
});

test("reference links resolve safely and never expose their definitions", () => {
  const text = 'Read [the **report**][source].\n\n[source]: https://example.com/report "Report"';
  const html = renderToStaticMarkup(<ArticleSummary text={text} />);
  assert.match(html, /href="https:\/\/example.com\/report" title="Report"/);
  assert.doesNotMatch(html, /\[source\]/);
  assert.equal(summaryPlainText(text), "Read the report.");
  assert.match(
    summaryMarkdown(text),
    /\[the \*\*report\*\*\]\(https:\/\/example.com\/report "Report"\)/,
  );
});

test("raw HTML, images and unsafe links remain inert in HTML and Markdown exports", () => {
  const text =
    "**<script>alert(1)</script>** [unsafe](javascript:alert%281%29) [encoded](jav&#x61;script:alert%281%29) ![image](https://example.com/image) <img src=x onerror=alert(1)> [credentials](https://user:password@example.com) [reference][bad]\n\n[bad]: data:text/html,unsafe";
  const html = renderToStaticMarkup(<ArticleSummary text={text} />);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<img|<a /);
  const exported = summaryMarkdown(text);
  assert.doesNotMatch(exported, /javascript:|jav&#x61;script:|data:text|user:password|!\[image\]/);
  assert.match(exported, /\\<script>/);
  assert.equal(renderToStaticMarkup(<ArticleSummary text={exported} />), html);
});

test("headings start below the page title without skipping levels", () => {
  const html = renderToStaticMarkup(
    <ArticleSummary
      text={"### First\r\nText\r\n\r\n## Second\r\n### Nested\r\n# Another section\r\n###### Deep"}
    />,
  );
  assert.match(
    html,
    /<h2>First<\/h2><p>Text<\/p><h2>Second<\/h2><h3>Nested<\/h3><h2>Another section<\/h2><h3>Deep<\/h3>/,
  );
});

test("Markdown exports preserve formatting while plain channels remove syntax", () => {
  assert.equal(
    summaryPlainText(brief),
    "Researchers report lower latency. Costs remain uncertain.\n\nTest conditions\n\nThe test used one workload.\n\nMemory cost\n\nMemory doubled.",
  );
  assert.equal(summaryMarkdown(brief), brief);
  const text = "A **bold**, *qualified* [claim](https://example.com).";
  assert.equal(summaryInlineText(text), "A bold, qualified claim.");
  assert.equal(summaryInlineMarkdown(text), text);
});

test("escaped markers and malformed Markdown follow CommonMark without guessing boundaries", () => {
  const html = renderToStaticMarkup(
    <ArticleSummary
      text={"Literal \\*stars\\* and **unclosed. ## An inline marker stays inline."}
    />,
  );
  assert.equal(
    html,
    '<div class="article-summary"><p>Literal *stars* and **unclosed. ## An inline marker stays inline.</p></div>',
  );
});
