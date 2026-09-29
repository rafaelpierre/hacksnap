import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { discussionBriefBlocks } from "../lib/discussion-brief.ts";

test("legacy prose retains paragraphs, single line breaks, and punctuation", () => {
  assert.deepEqual(
    discussionBriefBlocks(" First line.\nStill the same paragraph.\r\n \r\nSecond paragraph. "),
    [
      { type: "paragraph", text: "First line.\nStill the same paragraph." },
      { type: "paragraph", text: "Second paragraph." },
    ],
  );
  assert.deepEqual(discussionBriefBlocks(" \n"), []);
  assert.deepEqual(discussionBriefBlocks("Cost is -5%."), [
    { type: "paragraph", text: "Cost is -5%." },
  ]);
});

test("worker bullet lines group together and preserve surrounding prose", () => {
  assert.deepEqual(
    discussionBriefBlocks("Opening.\r\n\r\n- First.\r\n- Second.\n\nClosing.\n\n- Third."),
    [
      { type: "paragraph", text: "Opening." },
      { type: "list", items: ["First.", "Second."] },
      { type: "paragraph", text: "Closing." },
      { type: "list", items: ["Third."] },
    ],
  );
});
