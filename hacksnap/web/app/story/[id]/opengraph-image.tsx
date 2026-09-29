import { storyIdFromSlug } from "../../../lib/story-url";
import { availableData, unavailableResponse } from "../../../lib/data-availability";
import { notFound } from "next/navigation";
import { getStory } from "../../../lib/data";
import { domain } from "../../../lib/format";
import { ogImage } from "../../../lib/og-image";

export const alt = "Hacksnap story — article brief and Hacker News discussion highlights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 1800;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  const id = storyIdFromSlug(slug);
  if (!id) notFound();
  const result = await availableData(() => getStory(id));
  if (!result.available) return unavailableResponse();
  const story = result.value;
  if (!story) notFound();
  return ogImage({
    title: story.title,
    source: domain(story.url),
    takeaway: story.summary?.overall_takeaway,
  });
}
