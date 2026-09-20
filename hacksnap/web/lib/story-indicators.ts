import type { Story } from "./data";
import { activityIntervals, activityChange, formatRate } from "./activity-history.ts";
import { sentimentLabel } from "./sentiment.ts";

// Shared plain text for Markdown and RSS, using the front page's measured rates.
export function storyIndicators(story: Story, asOf: string): string[] {
  const sentiment = story.summary?.sentiment ?? null;
  const label = sentimentLabel(sentiment, story.summary?.source_coverage?.included_comments === 0);
  const lines = [`Sentiment: ${label}${sentiment === null ? "" : ` (${sentiment > 0 ? "+" : ""}${sentiment})`}. Estimated from sampled thread comments; mixed or inconclusive reactions are Neutral. This is not a community vote.`];
  const intervals = activityIntervals(story.activity_history ?? [], asOf);
  lines.push(`Hotness (past 24h; as of ${asOf})`);
  if (!intervals.length) {
    lines.push("Collecting history. At least two observations in the past 24 hours are needed.");
    return lines;
  }
  const change = activityChange(intervals);
  lines.push(change === null ? "Not enough history to measure a change in activity."
    : `${formatRate(change)} points/hour change from the first to the latest measured rate.`);
  lines.push("Measured interval averages (earlier activity and activity between observations are unknown):");
  for (const interval of intervals) {
    lines.push(`${new Date(interval.start).toISOString()} to ${new Date(interval.end).toISOString()}: ${formatRate(interval.rate)} points/hour`);
  }
  return lines;
}
