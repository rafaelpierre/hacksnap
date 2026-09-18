export type ScoreObservation = { observed_at: string; score: number };

// Correlated with the selected leaderboard story, using (hn_id, observed_at).
// Bound payload size even for stories that have been tracked for months.
export const scoreHistorySQL = `COALESCE((
  SELECT json_agg(observation ORDER BY observation.observed_at) FROM (
    SELECT observed_at, score
    FROM hn_thread_snapshots
    WHERE hn_id = t.hn_id
    ORDER BY observed_at DESC, snapshot_id DESC
    LIMIT 168
  ) observation
), '[]'::json)`;

export function chartPoints(history: ScoreObservation[]) {
  const start = Date.parse(history[0]?.observed_at ?? "");
  const end = Date.parse(history.at(-1)?.observed_at ?? "");
  const counts = history.map(point => point.score);
  const low = Math.min(...counts);
  const high = Math.max(...counts);
  return history.map(point => ({
    ...point,
    x: end === start ? 80 : 6 + ((Date.parse(point.observed_at) - start) / (end - start)) * 148,
    y: high === low ? 30 : 54 - ((point.score - low) / (high - low)) * 48,
  }));
}

// A Bezier trend uses observations as control points rather than passing
// through every sample. De Casteljau evaluation stays inside their convex hull,
// preserves the endpoints, and produces broader smoothing with sparse history.
export function smoothPath(points: {x: number; y: number}[]): string {
  if (!points.length) return "";
  const start = `M${points[0].x},${points[0].y}`;
  if (points.length < 3 || points.some((p, i) => i > 0 && p.x <= points[i - 1].x)) {
    return start + points.slice(1).map(p => ` L${p.x},${p.y}`).join("");
  }
  // Evaluate a continuous trend at 64 steps for a smooth SVG outline.
  let path = start;
  for (let step = 1; step <= 64; step++) {
    const t = step / 64;
    const work = points.map(p => ({...p}));
    for (let remaining = work.length - 1; remaining > 0; remaining--) {
      for (let i = 0; i < remaining; i++) {
        work[i].x += (work[i + 1].x - work[i].x) * t;
        work[i].y += (work[i + 1].y - work[i].y) * t;
      }
    }
    path += ` L${work[0].x},${work[0].y}`;
  }
  return path;
}
