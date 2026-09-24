import type { MetadataRoute } from "next";
import { getSitemapStories, getArchiveMonths } from "../lib/data";
import { sitemapEntries } from "../lib/sitemap";
import { CATEGORIES, categoryURL } from "../lib/categories";

// Query at request time so publication and deletion require no rebuild or purge.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await getSitemapStories();
  const months = await getArchiveMonths();
  return [...sitemapEntries(stories),
    ...CATEGORIES.map(category => ({url: `https://hacksnap.live${categoryURL(category)}`})),
    {url: "https://hacksnap.live/archive"},
    ...months.map(({month}) => ({url: `https://hacksnap.live/archive/${month.replace("-", "/")}`})),
  ];
}
