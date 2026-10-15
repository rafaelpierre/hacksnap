import { storySlugColumnSQL } from "./story-slug-projection";
import { initialMetricsColumnsSQL } from "./initial-metrics";

export const storyTitleColumnSQL = `SELECT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'hacksnap_summaries'::regclass AND attname = 'title'
    AND NOT attisdropped AND has_column_privilege(attrelid, attname, 'SELECT')
) AS available`;

export const storyIdentityColumnsSQL = `SELECT
  (${storySlugColumnSQL}) AS slug_available,
  (${storyTitleColumnSQL}) AS title_available,
  (${initialMetricsColumnsSQL}) AS initial_metrics_available`;

export function storyTitleProjection(available: boolean): string {
  return available ? "COALESCE(NULLIF(BTRIM(s.title), ''), t.title) AS title" : "t.title";
}
