import { availableData, unavailableResponse } from "../../lib/data-availability";
import { getFeedStories } from "../../lib/data";
import { renderRSS } from "../../lib/rss";
import { PUBLIC_CACHE_CONTROL } from "../../lib/public-story";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await availableData(getFeedStories);
  if (!result.available) return unavailableResponse();
  return new Response(renderRSS(result.value), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": PUBLIC_CACHE_CONTROL,
    },
  });
}
