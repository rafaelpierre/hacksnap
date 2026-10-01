import { archiveMonth, archivePage } from "./archive";
import { boundedCache } from "./bounded-cache";
import { categoryBySlug } from "./categories";
import type { FeedPagination } from "./feed-state";
import type { getArchiveStories, getCategoryStories } from "./data";
import { publicFeedStory } from "./stories-api";

export function browsePagination(page: number, hasMore: boolean): FeedPagination {
  return {
    page,
    hasMore,
    cursor: null,
    previousCursor: null,
    expiresAt: null,
    selectionLimited: false,
  };
}

export function browseStoriesHandler(data: {
  getArchiveStories: typeof getArchiveStories;
  getCategoryStories: typeof getCategoryStories;
}) {
  // These listings change as stories are ingested or recategorized. Keep a short,
  // per-instance snapshot to absorb repeated page loads without extending the
  // freshness window at a CDN. Hard expiry means an expired result is never served.
  const cachedBrowsePage = boundedCache(
    async (key: string) => {
      const separator = key.lastIndexOf(":");
      const path = key.slice(0, separator);
      const page = Number(key.slice(separator + 1));
      const categoryMatch = /^\/category\/([a-z-]+)$/.exec(path);
      const category = categoryMatch ? categoryBySlug(categoryMatch[1]) : null;
      const monthMatch = /^\/archive\/([^/]+)\/([^/]+)$/.exec(path);
      const month = monthMatch ? archiveMonth(monthMatch.slice(1)) : null;
      return category
        ? data.getCategoryStories(category.id, page)
        : data.getArchiveStories(month, page);
    },
    { ttl: () => 60_000, maxEntries: 64, maxPending: 8 },
  );

  return async (request: Request) => {
    const query = new URL(request.url).searchParams;
    const path = query.get("path");
    const page = archivePage(query.get("page") ?? undefined);
    const categoryMatch = /^\/category\/([a-z-]+)$/.exec(path ?? "");
    const category = categoryMatch ? categoryBySlug(categoryMatch[1]) : null;
    const monthMatch = /^\/archive\/([^/]+)\/([^/]+)$/.exec(path ?? "");
    const month = monthMatch ? archiveMonth(monthMatch.slice(1)) : null;
    if (
      !path ||
      !page ||
      (!category && path !== "/archive" && !month) ||
      [...query.keys()].some(
        (key) => !["path", "page"].includes(key) || query.getAll(key).length !== 1,
      )
    )
      return Response.json(
        { error: "Invalid story listing" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    try {
      const result = await cachedBrowsePage(`${path}:${page}`);
      return Response.json(
        {
          stories: result.stories.map(publicFeedStory),
          pagination: browsePagination(page, result.hasNext),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return Response.json(
        { error: "Stories are temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
  };
}
