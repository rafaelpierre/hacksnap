export type RankObservation = { observed_at: string; rank: number; current?: boolean };

// The live view can change between captures (including at the 24-hour cutoff).
// Keep saved observations intact and label the read-time endpoint separately.
export function withCurrentRank(history: RankObservation[], rank: number, observedAt: string): RankObservation[] {
  return [...history, {observed_at: observedAt, rank, current: true}];
}

// Correlated with the selected leaderboard story, using (hn_id, observed_at).
// Bound payload size even for stories that have been tracked for months.
export const rankHistorySQL = `COALESCE((
  SELECT json_agg(observation ORDER BY observation.observed_at) FROM (
    SELECT observed_at, rank
    FROM hacksnap_rank_history
    WHERE hn_id = t.hn_id
    ORDER BY observed_at DESC
    LIMIT 168
  ) observation
), '[]'::json)`;

export function chartPoints(history: RankObservation[], maxRank = Math.max(10, ...history.map(point => point.rank))) {
  const start = Date.parse(history[0]?.observed_at ?? "");
  const end = Date.parse(history.at(-1)?.observed_at ?? "");
  return history.map(point => ({
    ...point,
    x: end === start ? 80 : 6 + ((Date.parse(point.observed_at) - start) / (end - start)) * 148,
    y: 6 + ((point.rank - 1) / (maxRank - 1)) * 48,
  }));
}

// Hold the last observed position until the next observation. We do not know
// the exact time of a rank change between samples.
export function rankPath(points: {x: number; y: number}[]): string {
  return points.map((point, i) => i ? `H${point.x} V${point.y}` : `M${point.x},${point.y}`).join(" ");
}
