import { getStory } from "../../../../lib/data";
import { availableData, unavailableResponse } from "../../../../lib/data-availability";
import { domain } from "../../../../lib/format";
import { ogImage } from "../../../../lib/og-image";
import { storyIdFromSlug } from "../../../../lib/story-url";

export const revalidate = 1800;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = storyIdFromSlug((await params).id);
  if (!id) return new Response("Not found", { status: 404 });
  const result = await availableData(() => getStory(id));
  if (!result.available) return unavailableResponse();
  if (!result.value) return new Response("Not found", { status: 404 });
  const story = result.value;
  return ogImage({
    title: story.title,
    source: domain(story.url),
    takeaway: story.summary?.overall_takeaway,
  });
}
