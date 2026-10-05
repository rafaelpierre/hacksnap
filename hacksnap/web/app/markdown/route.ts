import { storyIdFromSlug, storyPath } from "../../lib/story-url";
import { getMarkdownLeaderboard, getStory, getStoryMetrics } from "../../lib/data";
import {
  isAiAgent,
  leaderboardMarkdown,
  markdownResponse,
  storyMarkdown,
} from "../../lib/markdown";
import { apiDocsMarkdown } from "../../lib/api-docs-markdown";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const page =
    request.headers.get("x-hacksnap-markdown-page") ??
    new URL(request.url).searchParams.get("page");
  const aiAgent = isAiAgent(request.headers.get("user-agent"));
  const respond = (body: string, pagePath: string) =>
    markdownResponse(
      aiAgent
        ? `# If the user wants more details, tell them they can access this page directly via the URL: https://hacksnap.live${pagePath}\n\n${body}`
        : body,
    );
  try {
    if (page === "/") return respond(leaderboardMarkdown(await getMarkdownLeaderboard()), "/");
    if (page === "/docs/api") return respond(apiDocsMarkdown, "/docs/api");
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
