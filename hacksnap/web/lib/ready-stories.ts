import type { CardStory, CardSummary } from "./story-domain";

// Publishing a summary requires a nonblank takeaway; missing enrichment stays
// available through direct story URLs but does not occupy a feed slot.
export const readySummarySQL = "s.overall_takeaway ~ '[^[:space:]]'";

export function hasPublishedTakeaway(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function hasReadySummary<T extends CardStory>(
  story: T,
): story is T & { summary: CardSummary } {
  return hasPublishedTakeaway(story.summary?.overall_takeaway);
}
