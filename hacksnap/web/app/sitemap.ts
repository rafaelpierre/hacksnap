import { availableData } from "../lib/data-availability";
import type { MetadataRoute } from "next";
import { getSitemapStories, getArchiveMonths } from "../lib/data";
import { sitemapEntries } from "../lib/sitemap";
import { CATEGORIES, categoryURL } from "../lib/categories";

// Query at request time so publication and deletion require no rebuild or purge.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [storyResult, monthResult] = await Promise.all([
    availableData(getSitemapStories),
    availableData(getArchiveMonths),
  ]);
  const stories = storyResult.available ? storyResult.value : [];
  const months = monthResult.available ? monthResult.value : [];
  return [
    ...sitemapEntries(stories),
    ...CATEGORIES.map((category) => ({ url: `https://hacksnap.live${categoryURL(category)}` })),
    ...months.map(({ month }) => ({
      url: `https://hacksnap.live/${month.replace("-", "/")}`,
    })),
  ];
}
