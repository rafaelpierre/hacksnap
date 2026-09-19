import type { MetadataRoute } from "next";
import { getSitemapStories } from "../lib/data";

// Query at request time so publication and deletion require no rebuild or purge.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await getSitemapStories();
  return [
    { url: "https://hacksnap.live/" },
    ...stories.map(story => ({
      url: `https://hacksnap.live/story/${story.hn_id}`,
      lastModified: story.modified_at,
    })),
  ];
}
