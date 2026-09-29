/** Readable URLs retain the source ID so duplicate or edited headlines stay resolvable. */
export function storySlug(id: string, title: string): string {
  const headline = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${headline || "story"}-${id}`;
}

export function storyPath(id: string, title: string): string {
  return `/story/${storySlug(id, title)}`;
}

export function canonicalStoryUrl(id: string, title: string): string {
  return `https://hacksnap.live${storyPath(id, title)}`;
}

/** Accept old numeric URLs and bounded headline slugs, never arbitrary ID suffixes. */
export function storyIdFromSlug(slug: string): string | null {
  if (slug !== slug.trim()) return null;
  if (/^[1-9][0-9]{0,14}$/.test(slug)) return slug;
  if (slug.length > 96 || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[1-9][0-9]{0,14}$/.test(slug)) return null;
  return slug.slice(slug.lastIndexOf("-") + 1);
}
