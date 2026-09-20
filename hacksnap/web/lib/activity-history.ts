export type ActivityObservation = { observed_at: string; score: number };
export type ActivityInterval = { start: number; end: number; rate: number };
const HOUR = 3_600_000;
export const ACTIVITY_WINDOW = 24 * HOUR;

// Uses the existing (hn_id, observed_at DESC) index and projects only metrics.
// No page-refresh endpoint: a page read is not a new HN observation.
export const activityHistorySQL = `COALESCE((
  SELECT json_agg(observation ORDER BY observation.observed_at) FROM (
    SELECT observed_at, score
    FROM hn_thread_snapshots
    WHERE hn_id = t.hn_id
      AND observed_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
      AND observed_at <= CURRENT_TIMESTAMP
    ORDER BY observed_at DESC, snapshot_id DESC
    LIMIT 168
  ) observation
), '[]'::json)`;

export function activityIntervals(history: ActivityObservation[], asOf: string): ActivityInterval[] {
  const now = Date.parse(asOf);
  const samples = new Map<number, number>();
  for (const point of history) {
    const at = Date.parse(point.observed_at);
    if (Number.isFinite(at) && Number.isFinite(point.score) && at >= now - ACTIVITY_WINDOW && at <= now) samples.set(at, point.score);
  }
  const sorted = [...samples].sort(([a], [b]) => a - b);
  return sorted.slice(1).map(([end, score], i) => {
    const [start, previous] = sorted[i];
    return {start, end, rate: (score - previous) / ((end - start) / HOUR)};
  });
}

export function activityChart(intervals: ActivityInterval[], asOf: string) {
  // Per-story scale with a minimum range prevents tiny changes filling the chart.
  const min = Math.min(0, ...intervals.map(p => p.rate));
  const max = Math.max(10, ...intervals.map(p => p.rate));
  const x = (at: number) => 6 + (at - (Date.parse(asOf) - ACTIVITY_WINDOW)) / ACTIVITY_WINDOW * 148;
  const y = (rate: number) => 54 - (rate - min) / (max - min) * 48;
  // Plot each interval average at its ending observation. Connections are visual guides.
  const points = intervals.map(p => ({...p, x: x(p.end), y: y(p.rate)}));
  // Extend the earliest known rate left as a visual lead-in, without adding a sample.
  const path = points.length
    ? `M6,${points[0].y} ` + points.map(p => `L${p.x},${p.y}`).join(' ')
    : '';
  return {points, path, baseline: y(0), min, max};
}

export function formatRate(rate: number): string {
  if (rate === 0) return '0';
  if (Math.abs(rate) < 0.1) return rate > 0 ? '+<0.1' : '−<0.1';
  return `${rate > 0 ? '+' : '−'}${Math.abs(rate).toLocaleString('en-GB', {maximumFractionDigits: 1})}`;
}
