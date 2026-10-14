import type { CardStory, CardSummary } from "./story-domain";

// Publishing a summary requires a nonblank takeaway; missing enrichment stays
// available through direct story URLs but does not occupy a feed slot.
// An explicitly unavailable original is excluded even when a takeaway was stored.
export const availableSourceSQL =
  "COALESCE(s.source_coverage->>'article_status', '') <> 'unavailable'";
export const readySummarySQL = `s.overall_takeaway ~ '[^[:space:]]' AND ${availableSourceSQL}`;

export function hasPublishedTakeaway(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function hasReadySummary<T extends CardStory>(
  story: T,
): story is T & { summary: CardSummary } {
  return (
    hasPublishedTakeaway(story.summary?.overall_takeaway) &&
    story.summary?.source_coverage?.article_status !== "unavailable"
  );
}
