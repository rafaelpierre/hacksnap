import { getLeaderboard, getStory } from "../../lib/data";
import { leaderboardMarkdown, markdownResponse, storyMarkdown } from "../../lib/markdown";
import { apiDocsMarkdown } from "../../lib/api-docs-markdown";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const page = request.headers.get("x-hacksnap-markdown-page") ?? new URL(request.url).searchParams.get("page");
  try {
    if (page === "/") return markdownResponse(leaderboardMarkdown(await getLeaderboard()));
    if (page === "/docs/api") return markdownResponse(apiDocsMarkdown);
    const match = page?.match(/^\/story\/([1-9][0-9]{0,14})$/);
    if (match) {
      const story = await getStory(match[1]);
      if (story) return markdownResponse(storyMarkdown(story));
    }
    return markdownResponse("# Not found\n", 404);
  } catch {
    return markdownResponse("# Stories are temporarily unavailable\n\nPlease retry after 60 seconds.\n", 503);
  }
}

export async function HEAD(request: Request) {
  const response = await GET(request);
  return new Response(null, {status: response.status, headers: response.headers});
}
