import type { MetadataRoute } from "next";
import { getSitemapStories, getArchiveMonths } from "../lib/data";
import { sitemapEntries } from "../lib/sitemap";

// Query at request time so publication and deletion require no rebuild or purge.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await getSitemapStories();
  const months = await getArchiveMonths();
  return [...sitemapEntries(stories),
    {url: "https://hacksnap.live/archive"},
    ...months.map(({month}) => ({url: `https://hacksnap.live/archive/${month.replace("-", "/")}`})),
  ];
}
