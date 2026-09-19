export type RankObservation = { observed_at: string; rank: number };

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

export function chartPoints(history: RankObservation[]) {
  const start = Date.parse(history[0]?.observed_at ?? "");
  const end = Date.parse(history.at(-1)?.observed_at ?? "");
  const ranks = history.map(point => point.rank);
  const low = Math.min(...ranks);
  const high = Math.max(...ranks);
  return history.map(point => ({
    ...point,
    x: end === start ? 80 : 6 + ((Date.parse(point.observed_at) - start) / (end - start)) * 148,
    y: high === low ? 30 : 6 + ((point.rank - low) / (high - low)) * 48,
  }));
}

// Connect recorded positions exactly; smoothing would hide rank reversals.
export function rankPath(points: {x: number; y: number}[]): string {
  return points.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ");
}
