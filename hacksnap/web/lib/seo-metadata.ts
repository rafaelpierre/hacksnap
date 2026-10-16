// Only public copy is read by the website; generation provenance stays private.
export const seoColumnsSQL = `SELECT count(*) = 2 AS available
  FROM pg_attribute
  WHERE attrelid = 'hacksnap_summaries'::regclass
    AND attname IN ('seo_title', 'seo_description') AND NOT attisdropped
    AND has_column_privilege(attrelid, attname, 'SELECT')`;

export function validSeoText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= limit &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !/[<>`]|\*\*|\[[^\]]+\]\(|https?:\/\//u.test(value) &&
    !/^(?:"|')|(?:…|\.\.\.)$/u.test(value.trim())
  );
}
