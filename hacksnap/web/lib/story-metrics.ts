import type { Story } from "./data";
import type { RankObservation } from "./rank-history";
import { skepticismDisplay } from "./sentiment.ts";

export type RankingMetrics = {
  peak_rank: number | null;
  observation_count: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
  top_ten_hours: number | null;
  history: RankObservation[];
};

// All retained observations inform the totals; only the chart payload is capped.
// The (hn_id, observed_at) primary key bounds the scan to this story. Thirteen
// hours covers the scheduled overnight gap with an hour of timing tolerance.
export const storyMetricsSQL = `(WITH observations AS MATERIALIZED (
  SELECT observed_at, rank, lead(observed_at) OVER (ORDER BY observed_at) AS next_at
  FROM hacksnap_rank_history
  WHERE hn_id = t.hn_id AND observed_at <= CURRENT_TIMESTAMP
), intervals AS (
  SELECT *, next_at - observed_at <= INTERVAL '13 hours' AS measured
  FROM observations
)
SELECT json_build_object(
  'peak_rank', min(rank),
  'observation_count', count(*),
  'first_observed_at', min(observed_at),
  'last_observed_at', max(observed_at),
  'top_ten_hours', CASE WHEN count(*) FILTER (WHERE measured) > 0 THEN
    COALESCE(sum(EXTRACT(EPOCH FROM next_at - observed_at) / 3600)
      FILTER (WHERE measured AND rank <= 10), 0) ELSE NULL END,
  'history', COALESCE((SELECT json_agg(point ORDER BY point.observed_at) FROM (
    SELECT observed_at, rank FROM observations ORDER BY observed_at DESC LIMIT 168
  ) point), '[]'::json)
) FROM intervals)`;

export const RANKING_METHOD = "Hacksnap ranks recent stories first, then orders each group by points. Peak rank uses all retained observations. Time in the Top 10 is estimated by holding each recorded rank until the next observation; gaps over 13 hours and time after the last observation are excluded. Movement between observations is unknown.";

export function storyMetrics(story: Story) {
  const coverage = story.summary?.source_coverage;
  const sentimentComments = coverage?.sentiment?.included_comments;
  const {label, position} = skepticismDisplay(story.summary?.sentiment ?? null,
    (sentimentComments ?? coverage?.included_comments) === 0);
  const ranking = story.ranking_metrics;
  const hours = ranking?.top_ten_hours;
  return {
    skepticism: label,
    position,
    skepticismNote: position === null
      ? label === "No comments" ? "No usable comments available to estimate skepticism." : "Skepticism will appear after analysis."
      : `${sentimentComments === undefined ? "Estimated from sampled comments" : `Estimated from ${sentimentComments} analysed ${sentimentComments === 1 ? "comment" : "comments"}`}.`,
    comments: coverage ? `${coverage.included_comments.toLocaleString("en-GB")} ${coverage.included_comments === 1 ? "comment" : "comments"} analysed` : "Analysis pending",
    peak: ranking?.peak_rank == null ? "Not yet recorded" : `#${ranking.peak_rank.toLocaleString("en-GB")}`,
    topTen: hours == null ? "Not enough history" : hours > 0 && hours < 0.1 ? "<0.1 hours" : `${hours.toLocaleString("en-GB", {minimumFractionDigits: 1, maximumFractionDigits: 1})} hours`,
  };
}

export function storyMetricsText(story: Story): string[] {
  const metrics = storyMetrics(story);
  const lines = [`Skept-o-meter — Skepticism: ${metrics.skepticism}. ${metrics.skepticismNote}`,
    `${metrics.comments} for the summary.`];
  if (story.ranking_metrics) {
    lines.push(`Peak observed Hacksnap rank: ${metrics.peak}`,
      `Estimated time in Hacksnap Top 10: ${metrics.topTen}`, RANKING_METHOD);
    const ranking = story.ranking_metrics;
    if (ranking.first_observed_at && ranking.last_observed_at) {
      lines.push(`${ranking.observation_count} recorded rank observations from ${ranking.first_observed_at} to ${ranking.last_observed_at}.`,
        `Hotness — latest ${ranking.history.length} recorded Hacksnap ranks:`);
      for (const point of ranking.history) lines.push(`${point.observed_at}: rank #${point.rank}`);
    }
  }
  return lines;
}
