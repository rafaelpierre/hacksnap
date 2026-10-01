import assert from "node:assert/strict";
import { test } from "@jest/globals";
import type { ArticleStory, CardSummary, CardStory } from "../lib/story-domain";

test("card and HTML article contracts stay separate", () => {
  // These assignments fail typecheck if a later projection adds full content
  // to cards or retained metrics to the HTML article contract.
  const cardHasNoArticle: "article_summary" extends keyof CardSummary ? false : true = true;
  const cardHasNoAnalysis: "discussion_analysis" extends keyof CardSummary ? false : true = true;
  const cardHasNoMetrics: "ranking_metrics" extends keyof CardStory ? false : true = true;
  const articleHasNoMetrics: "ranking_metrics" extends keyof ArticleStory ? false : true = true;
  assert.deepEqual(
    [cardHasNoArticle, cardHasNoAnalysis, cardHasNoMetrics, articleHasNoMetrics],
    [true, true, true, true],
  );
});
