import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { briefExcerpt } from "../lib/brief.ts";
import { briefSentences } from "../lib/article-brief.ts";

test("brief sentences keep honorifics with names at the start and inside sentences", () => {
  for (const title of ["Dr", "Mr", "Mrs", "Ms", "Mx", "Prof", "Rev", "Hon", "Fr"]) {
    for (const prefix of ["", "The report cites "]) {
      const first = `${prefix}${title}. Smith reviewed the results. `;
      const second = "Further testing is needed.";
      assert.deepEqual(briefSentences(first + second), [first, second]);
    }
  }
});

test("brief sentences retain consecutive titles and ordinary sentence breaks", () => {
  const first = "Prof. Dr. Smith tested version 3.5. ";
  const second = "Did it work? ";
  const third = "Yes!";
  const text = first + second + third;
  const sentences = briefSentences(text);
  assert.deepEqual(sentences, [first, second, third]);
  assert.equal(sentences.join(""), text);
  assert.deepEqual(briefSentences("One sentence."), ["One sentence."]);
  assert.deepEqual(briefSentences(null), []);
  assert.deepEqual(briefSentences("   "), []);
});

for (const [name, expected] of [
  ["initials", ["J. R. Smith tested it. ", "The results held."]],
  ["acronyms", ["U.S. researchers tested it. ", "They agreed."]],
  ["examples", ["It supports e.g. Python and JavaScript. ", "Results vary."]],
  ["URLs and currency", ["Try https://example.com/v1.2 first. ", "It costs $2.50."]],
  ["quotes", ["“It works,” Dr. Smith said. ", "More tests follow."]],
  ["ellipses", ["Wait... does it work? ", "Yes!"]],
]) {
  test(`article sentence breaks handle ${name}`, () => {
    const text = expected.join("");
    assert.deepEqual(briefSentences(text), expected);
    assert.equal(briefSentences(text).join(""), text);
  });
}

test("article sentence breaks handle existing line breaks and repeated whitespace", () => {
  assert.deepEqual(briefSentences("  Dr.  Smith tested it.\n\nResults held.  "), [
    "Dr. Smith tested it. ",
    "Results held.",
  ]);
});

test("short takeaways keep their caveats and pending summaries stay empty", () => {
  const text = "The result improves throughput, but only with batching.";
  assert.equal(briefExcerpt(text), text);
  assert.equal(briefExcerpt(null), "");
  assert.equal(briefExcerpt("   "), "");
});
test("legacy decks prefer complete sentences and never mutate the full takeaway", () => {
  const text = "The benchmark excludes review time. " + "Supporting detail matters. ".repeat(20);
  const original = text;
  const result = briefExcerpt(text);
  assert.ok(result.length <= 220);
  assert.ok(result.endsWith("."));
  assert.ok(text.startsWith(result));
  assert.equal(text, original);
});
test("a production-length single sentence prefers its complete opening clause", () => {
  const text =
    "The report's core finding is that a weak sandbox plus public web services let agents bootstrap code execution and extensive data access; the discussion is split between alarm at the scale and resourcefulness of the behavior and skepticism that it demonstrates misalignment rather than an instructed task with poor containment.";
  const excerpt = briefExcerpt(text);
  assert.ok(excerpt.length <= 220);
  assert.ok(excerpt.endsWith("."));
  assert.equal(excerpt, text.split(";")[0] + ".");
  assert.ok(briefExcerpt("Long supporting evidence ".repeat(30)).endsWith("…"));
  assert.ok(briefExcerpt("x".repeat(4000)).length <= 220);
});
