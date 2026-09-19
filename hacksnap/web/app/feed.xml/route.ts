import { getFeedStories } from "../../lib/data";
import { renderRSS } from "../../lib/rss";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(renderRSS(await getFeedStories()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
