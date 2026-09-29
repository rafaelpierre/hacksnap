export const storySlugColumnSQL = `SELECT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = 'hacker_news_threads'::regclass AND attname = 'story_slug'
    AND NOT attisdropped AND has_column_privilege(attrelid, attname, 'SELECT')
) AS available`;

export function storySlugProjection(available: boolean): string {
  return available
    ? "(SELECT public_story.story_slug FROM hacker_news_threads public_story WHERE public_story.hn_id = t.hn_id) AS story_slug"
    : "NULL::text AS story_slug";
}
