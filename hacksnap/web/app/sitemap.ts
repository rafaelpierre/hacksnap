import type { MetadataRoute } from "next";
import { getSitemapStories } from "../lib/data";
import { sitemapEntries } from "../lib/sitemap";

// Query at request time so publication and deletion require no rebuild or purge.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await getSitemapStories();
  return sitemapEntries(stories);
}
