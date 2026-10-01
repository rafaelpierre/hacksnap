import type { CardStory, CardSummary } from "./story-domain";

export function hasReadySummary<T extends CardStory>(
  story: T,
): story is T & { summary: CardSummary } {
  return Boolean(story.summary?.overall_takeaway?.trim());
}
