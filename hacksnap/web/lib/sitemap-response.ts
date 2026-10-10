import "server-only";
import { boundedCache } from "./bounded-cache";
import { getSitemapPartitions, getSitemapStories, getArchiveMonths } from "./data";
import { DataUnavailableError, unavailableResponse } from "./data-availability";
import { CATEGORIES, categoryURL } from "./categories";
import { sitemapEntries, sitemapRange, sitemapXML } from "./sitemap";

const generate = boundedCache(
  async (id) => {
    if (id === "index") {
      const partitions = await getSitemapPartitions();
      return sitemapXML(
        ["pages", ...partitions.map((partition) => partition.id)].map((key) => ({
          url: `https://hacksnap.live/sitemap/${key}.xml`,
        })),
        true,
      );
    }
    if (id === "pages") {
      const months = await getArchiveMonths();
      return sitemapXML([
        { url: "https://hacksnap.live/" },
        ...CATEGORIES.map((category) => ({ url: `https://hacksnap.live${categoryURL(category)}` })),
        ...months.map(({ month }) => ({ url: `https://hacksnap.live/${month.replace("-", "/")}` })),
      ]);
    }
    return sitemapXML(sitemapEntries(await getSitemapStories(id)).slice(1));
  },
  { ttl: () => 300_000, maxEntries: 10, maxPending: 2 },
);

export async function sitemapResponse(id: string): Promise<Response> {
  if (id !== "index" && id !== "pages") {
    try {
      sitemapRange(id);
    } catch {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }
  try {
    return new Response(await generate(id), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    if (
      error instanceof DataUnavailableError ||
      (error instanceof Error && error.message === "Public data is busy")
    )
      return unavailableResponse();
    throw error;
  }
}
