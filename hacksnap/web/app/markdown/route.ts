import { storyIdFromSlug, storyPath } from "../../lib/story-url";
import {
  getArchiveMonths,
  getArchiveStories,
  getCategoryStories,
  getStory,
  getStoryMetrics,
} from "../../lib/data";
import { isAiAgent, latestMarkdown, markdownResponse, storyMarkdown } from "../../lib/markdown";
import { archiveMonth, archivePage, archiveURL } from "../../lib/archive";
import { categoryBySlug, categoryURL } from "../../lib/categories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestURL = new URL(request.url);
  const page =
    request.headers.get("x-hacksnap-markdown-page") ?? requestURL.searchParams.get("page");
  const aiAgent = isAiAgent(request.headers.get("user-agent"));
  const respond = (body: string, pagePath: string) =>
    markdownResponse(
      aiAgent
        ? `# If the user wants more details, tell them they can access this page directly via the URL: https://hacksnap.live${pagePath}\n\n${body}`
        : body,
    );
  try {
    const dated = page?.match(/^\/([1-9]\d{3})\/(0[1-9]|1[0-2])$/);
    const legacyDated = page?.match(/^\/archive\/([1-9]\d{3})\/(0[1-9]|1[0-2])$/);
    if (page === "/" || page === "/archive" || dated || legacyDated) {
      const dateMatch = dated ?? legacyDated;
      const month = dateMatch ? archiveMonth(dateMatch.slice(1)) : null;
      const query = new URLSearchParams(
        request.headers.get("x-hacksnap-markdown-query") ??
          (request.headers.has("x-hacksnap-markdown-page") ? requestURL.search : ""),
      );
      const pages = query.getAll("page");
      // Direct handler requests reserve `page` for the negotiated route.
      if (
        !request.headers.has("x-hacksnap-markdown-page") &&
        !request.headers.has("x-hacksnap-markdown-query")
      )
        pages.push(...requestURL.searchParams.getAll("feedPage"));
      const feedPage = archivePage(pages.length > 1 ? pages : pages[0]);
      if (feedPage === null) return markdownResponse("# Not found\n", 404);
      const categories = query.getAll("category");
      if (
        !request.headers.has("x-hacksnap-markdown-page") &&
        !request.headers.has("x-hacksnap-markdown-query")
      )
        categories.push(...requestURL.searchParams.getAll("category"));
      const category = categories.length === 1 ? categoryBySlug(categories[0]) : null;
      if (categories.length && (!category || page !== "/"))
        return markdownResponse("# Not found\n", 404);
      const canonical = category ? categoryURL(category, feedPage) : archiveURL(month, feedPage);
      if (page === "/archive" || legacyDated || query.has("cursor"))
        return new Response(null, {
          status: 308,
          headers: {
            Location: canonical,
            Vary: "Accept, User-Agent",
            "Cache-Control": "no-store",
            ...(query.has("cursor") ? { "X-Robots-Tag": "noindex, follow" } : {}),
          },
        });
      if (month && !(await getArchiveMonths()).some((item) => item.month === month))
        return markdownResponse("# Not found\n", 404);
      const result = category
        ? await getCategoryStories(category.id, feedPage)
        : await getArchiveStories(month, feedPage);
      if (feedPage > 1 && !result.stories.length) return markdownResponse("# Not found\n", 404);
      return respond(latestMarkdown({ ...result, month, page: feedPage, category }), canonical);
    }
    const match = page?.match(/^\/story\/([^/]+)$/);
    const id = match ? storyIdFromSlug(match[1]) : null;
    if (id) {
      const story = await getStory(id);
      if (story) {
        const canonical = storyPath(story.hn_id, story.story_slug);
        if (page !== canonical) {
          return new Response(null, {
            status: 308,
            headers: {
              Location: canonical,
              Vary: "Accept, User-Agent",
              "Cache-Control": "no-store",
            },
          });
        }
        const ranking_metrics = await getStoryMetrics(id);
        return respond(storyMarkdown({ ...story, ranking_metrics }), canonical);
      }
    }
    return markdownResponse("# Not found\n", 404);
  } catch {
    return markdownResponse(
      "# Stories are temporarily unavailable\n\nPlease retry after 60 seconds.\n",
      503,
    );
  }
}

export async function HEAD(request: Request) {
  const response = await GET(request);
  return new Response(null, { status: response.status, headers: response.headers });
}
