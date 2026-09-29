import { getStory } from "../../../../lib/data";
import { availableData, unavailableResponse } from "../../../../lib/data-availability";
import { ogImage } from "../../../../lib/og-image";
import { readyStoryImage } from "../../../../lib/story-image";
import { storyIdFromSlug } from "../../../../lib/story-url";

export const revalidate = 1800;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = storyIdFromSlug((await params).id);
  if (!id) return new Response("Not found", { status: 404 });
  const result = await availableData(() => getStory(id));
  if (!result.available) return unavailableResponse();
  if (!result.value) return new Response("Not found", { status: 404 });
  const image = readyStoryImage(result.value);
  return image ? Response.redirect(image.url, 307) : ogImage();
}
