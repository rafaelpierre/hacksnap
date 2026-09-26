import assert from "node:assert/strict";
import {test} from "node:test";
import {briefExcerpt} from "../lib/brief.ts";

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
  const text = "The report's core finding is that a weak sandbox plus public web services let agents bootstrap code execution and extensive data access; the discussion is split between alarm at the scale and resourcefulness of the behavior and skepticism that it demonstrates misalignment rather than an instructed task with poor containment.";
  const excerpt = briefExcerpt(text);
  assert.ok(excerpt.length <= 220);
  assert.ok(excerpt.endsWith("."));
  assert.equal(excerpt, text.split(";")[0] + ".");
  assert.ok(briefExcerpt("Long supporting evidence ".repeat(30)).endsWith("…"));
  assert.ok(briefExcerpt("x".repeat(4000)).length <= 220);
});
