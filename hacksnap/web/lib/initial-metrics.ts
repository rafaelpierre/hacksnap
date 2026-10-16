export const initialMetricsColumnsSQL = `SELECT count(*) = 5 FROM pg_attribute
  WHERE attrelid = to_regclass('public.hn_thread_snapshots')
    AND attname IN ('hn_id', 'snapshot_id', 'observed_at', 'score', 'descendants')
    AND NOT attisdropped AND has_column_privilege(attrelid, attname, 'SELECT')`;

export function initialMetricsProjection(available: boolean): string {
  if (!available) return "NULL::integer AS points, NULL::integer AS comment_count";
  return [
    ["score", "points"],
    ["descendants", "comment_count"],
  ]
    .map(
      ([column, alias]) =>
        `(SELECT first_snapshot.${column} FROM hn_thread_snapshots first_snapshot
      WHERE first_snapshot.hn_id = t.hn_id
      ORDER BY first_snapshot.observed_at, first_snapshot.snapshot_id LIMIT 1) AS ${alias}`,
    )
    .join(", ");
}

export function initialMetricsText(story: {
  points: number | null;
  comment_count: number | null;
}): string {
  return [
    story.points === null ? null : `${story.points} points`,
    story.comment_count === null ? null : `${story.comment_count} comments`,
  ]
    .filter(Boolean)
    .join(" · ");
}
