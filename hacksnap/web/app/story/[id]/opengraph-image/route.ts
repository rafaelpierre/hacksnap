import { getStory, getFreshStory } from "../../../../lib/data";
import { connection } from "next/server";
import {
  storyISREnabled,
  trackPublicationForISR,
  trackUnpublishedForISR,
} from "../../../../lib/publication-cache";
import { hasReadySummary } from "../../../../lib/ready-stories";
import { availableData, unavailableResponse } from "../../../../lib/data-availability";
import { domain } from "../../../../lib/format";
import { ogImage } from "../../../../lib/og-image";
import { storyIdFromSlug } from "../../../../lib/story-url";

export const revalidate = 86400;
export const generateStaticParams = storyISREnabled() ? () => [] : undefined;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = storyIdFromSlug((await params).id);
  if (!id) {
    if (storyISREnabled()) await trackUnpublishedForISR();
    else await connection();
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const isr = storyISREnabled();
  if (!isr) await connection();
  const result = isr
    ? { available: true as const, value: await getFreshStory(id) }
    : await availableData(() => getStory(id));
  if (!result.available) return unavailableResponse();
  if (!result.value) {
    if (isr) await trackUnpublishedForISR();
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const story = result.value;
  if (!hasReadySummary(story) && isr) await trackUnpublishedForISR();
  else if (isr) await trackPublicationForISR();
  const image = await ogImage({
    title: story.title,
    source: domain(story.url),
    takeaway: story.summary?.overall_takeaway,
  });
  image.headers.set(
    "Cache-Control",
    isr && hasReadySummary(story) ? "public, max-age=0, must-revalidate" : "no-store",
  );
  return image;
}
