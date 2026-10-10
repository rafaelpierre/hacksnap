import { canonicalStoryUrl } from "./story-url";
export const SITEMAP_RANGE_SIZE = 10_000;

export function sitemapRange(id: string): [number, number] {
  if (!/^(0|[1-9]\d{0,10})$/.test(id)) throw new RangeError("Invalid sitemap partition");
  const start = Number(id) * SITEMAP_RANGE_SIZE;
  return [start, start + SITEMAP_RANGE_SIZE];
}

export function sitemapXML(entries: { url: string; lastModified?: Date }[], index = false) {
  const escape = (value: string) =>
    value.replace(
      /[<>&"']/g,
      (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!,
    );
  const root = index ? "sitemapindex" : "urlset";
  const tag = index ? "sitemap" : "url";
  if (entries.length > 50_000) throw new Error("Sitemap capacity exceeded");
  return `<?xml version="1.0" encoding="UTF-8"?><${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries
    .map(
      ({ url, lastModified }) =>
        `<${tag}><loc>${escape(url)}</loc>${lastModified ? `<lastmod>${lastModified.toISOString()}</lastmod>` : ""}</${tag}>`,
    )
    .join("")}</${root}>`;
}
export function sitemapEntries(
  stories: { hn_id: string; story_slug?: string | null; modified_at: Date }[],
) {
  const latest = stories.reduce<Date | undefined>(
    (value, story) => (!value || story.modified_at > value ? story.modified_at : value),
    undefined,
  );
  return [
    { url: "https://hacksnap.live/", ...(latest ? { lastModified: latest } : {}) },
    ...stories.map((story) => ({
      url: canonicalStoryUrl(story.hn_id, story.story_slug),
      lastModified: story.modified_at,
    })),
  ];
}
