export type RankObservation = { observed_at: string; rank: number };
export type RankSample = { at: number; rank: number };
export const RANK_WINDOW = 24 * 3_600_000;

// The existing (hn_id, observed_at) primary key supports this bounded lookup.
export const rankHistorySQL = `COALESCE((
  SELECT json_agg(observation ORDER BY observation.observed_at) FROM (
    SELECT observed_at, rank
    FROM hacksnap_rank_history
    WHERE hn_id = t.hn_id
      AND observed_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
      AND observed_at <= CURRENT_TIMESTAMP
    ORDER BY observed_at DESC
    LIMIT 168
  ) observation
), '[]'::json)`;

export function rankSamples(history: RankObservation[], asOf: string, currentRank?: string | number, windowMs = RANK_WINDOW): RankSample[] {
  const now = Date.parse(asOf);
  const samples = new Map<number, number>();
  for (const point of history) {
    const at = Date.parse(point.observed_at);
    if (Number.isFinite(at) && Number.isSafeInteger(point.rank) && point.rank > 0 && at >= now - windowMs && at <= now) samples.set(at, point.rank);
  }
  // The position actually displayed is also an observation, at the shared cache timestamp.
  const rank = Number(currentRank);
  if (Number.isFinite(now) && Number.isSafeInteger(rank) && rank > 0) samples.set(now, rank);
  return [...samples].sort(([a], [b]) => a - b).map(([at, rank]) => ({at, rank}));
}

export function rankChange(samples: RankSample[]): number | null {
  return samples.length < 2 ? null : samples[0].rank - samples[samples.length - 1].rank;
}

export function rankChart(samples: RankSample[]) {
  // Rank 1 is always at the top; expand to include positions outside the top ten.
  const max = Math.max(10, ...samples.map(p => p.rank));
  const start = samples[0]?.at ?? 0;
  const duration = (samples.at(-1)?.at ?? start) - start;
  const x = (at: number) => duration > 0 ? 6 + (at - start) / duration * 148 : 154;
  const y = (rank: number) => 6 + (rank - 1) / (max - 1) * 48;
  const points = samples.map(p => ({...p, x: x(p.at), y: y(p.rank)}));
  // Horizontal endpoint tangents keep every cubic inside its two observed ranks.
  // Flat intervals stay flat, and turns cannot overshoot into invented peaks.
  const path = points.map((p, i) => {
    if (!i) return `M${p.x},${p.y}`;
    const previous = points[i - 1];
    const third = (p.x - previous.x) / 3;
    return `C${previous.x + third},${previous.y} ${p.x - third},${p.y} ${p.x},${p.y}`;
  }).join(' ');
  return {points, path, baseline: 58, max, duration};
}

export function formatRankChange(change: number): string {
  return change === 0 ? '0' : `${change > 0 ? '+' : '−'}${Math.abs(change).toLocaleString('en-GB')}`;
}

export function formatRankDuration(duration: number): string {
  if (duration <= 0) return 'Now';
  if (duration < 60_000) return '<1m';
  if (duration < 3_600_000) return `${Math.floor(duration / 60_000)}m`;
  return `${(duration / 3_600_000).toLocaleString('en-GB', {maximumFractionDigits: 1})}h`;
}
