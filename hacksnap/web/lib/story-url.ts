/** Missing stored slugs keep existing stories at their original numeric URL. */
export function storyPath(id: string, slug?: string | null): string {
  return `/story/${slug && storyIdFromSlug(slug) === id ? slug : id}`;
}

export function canonicalStoryUrl(id: string, slug?: string | null): string {
  return `https://hacksnap.live${storyPath(id, slug)}`;
}

/** Accept old numeric URLs and bounded headline slugs, never arbitrary ID suffixes. */
export function storyIdFromSlug(slug: string): string | null {
  if (slug !== slug.trim()) return null;
  if (/^[1-9][0-9]{0,14}$/.test(slug)) return slug;
  if (slug.length > 96 || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[1-9][0-9]{0,14}$/.test(slug)) return null;
  return slug.slice(slug.lastIndexOf("-") + 1);
}
