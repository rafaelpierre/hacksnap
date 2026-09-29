import { storyIdFromSlug, storyPath } from "../../lib/story-url";
import { getLeaderboard, getStory } from "../../lib/data";
import { leaderboardMarkdown, markdownResponse, storyMarkdown } from "../../lib/markdown";
import { apiDocsMarkdown } from "../../lib/api-docs-markdown";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const page =
    request.headers.get("x-hacksnap-markdown-page") ??
    new URL(request.url).searchParams.get("page");
  try {
    if (page === "/") return markdownResponse(leaderboardMarkdown(await getLeaderboard()));
    if (page === "/docs/api") return markdownResponse(apiDocsMarkdown);
    const match = page?.match(/^\/story\/([^/]+)$/);
    const id = match ? storyIdFromSlug(match[1]) : null;
    if (id) {
      const story = await getStory(id);
      if (story) {
        const canonical = storyPath(story.hn_id, story.story_slug);
        if (page !== canonical) {
          return new Response(null, {
            status: 308,
            headers: { Location: canonical, Vary: "Accept", "Cache-Control": "no-store" },
          });
        }
        return markdownResponse(storyMarkdown(story));
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
