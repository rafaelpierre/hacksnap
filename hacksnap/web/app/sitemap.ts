import type { MetadataRoute } from "next";
import { getPublicStoryIds } from "../lib/data";

// Query at request time so publication and deletion require no rebuild or purge.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const ids = await getPublicStoryIds();
  return [
    { url: "https://hacksnap.live/" },
    ...ids.map(id => ({ url: `https://hacksnap.live/story/${id}` })),
  ];
}
