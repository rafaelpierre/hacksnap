import type { Story } from "./data";
import { rankSamples, rankChange, formatRankChange } from "./rank-history.ts";
import { sentimentLabel } from "./sentiment.ts";

// Shared plain text for Markdown and RSS, using the front page's observed ranks.
export function storyIndicators(story: Story, asOf: string): string[] {
  const sentiment = story.summary?.sentiment ?? null;
  const label = sentimentLabel(sentiment, story.summary?.source_coverage?.included_comments === 0);
  const lines = [`Sentiment: ${label}${sentiment === null ? "" : ` (${sentiment > 0 ? "+" : ""}${sentiment})`}. Estimated from sampled thread comments; mixed or inconclusive reactions are Neutral. This is not a community vote.`];
  const samples = rankSamples(story.rank_history ?? [], asOf, story.rank);
  lines.push(`Hotness (past 24h; as of ${asOf})`);
  if (!samples.length) {
    lines.push("Collecting history. No rank observations in the past 24 hours.");
    return lines;
  }
  const change = rankChange(samples);
  lines.push(change === null ? "Not enough history to measure a change in rank."
    : `${formatRankChange(change)} places changed from the first to the latest observed rank.`);
  lines.push("Observed Hacksnap ranks (higher on the chart means a better position; movement between observations is unknown):");
  for (const sample of samples) {
    lines.push(`${new Date(sample.at).toISOString()}: rank #${sample.rank}`);
  }
  return lines;
}
