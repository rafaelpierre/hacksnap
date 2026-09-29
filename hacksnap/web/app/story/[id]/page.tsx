import { storyIdFromSlug, storyPath } from "../../../lib/story-url";
import { availableData } from "../../../lib/data-availability";
import { withDataFallback } from "../../with-data-fallback";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { storyPreviewMetadata } from "../../../lib/preview-metadata";
import { getRelatedStories, getStory } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { StoryContent } from "./story-content";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: slug } = await params;
  const id = storyIdFromSlug(slug);
  if (!id) notFound();
  const result = await availableData(() => getStory(id));
  if (!result.available)
    return { title: "Story temporarily unavailable", robots: { index: false } };
  if (!result.value) notFound();
  return storyPreviewMetadata(result.value);
}

async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: slug } = await params;
  const id = storyIdFromSlug(slug);
  if (!id) notFound();
  const story = await getStory(id);
  if (!story) notFound();
  const canonical = storyPath(story.hn_id, story.title);
  if (`/story/${slug}` !== canonical) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
        query.append(key, entry);
    }
    permanentRedirect(canonical + (query.size ? `?${query}` : ""));
  }
  const category = categoryById(story.category);
  const related = await availableData(async () =>
    category ? getRelatedStories(category.id, story.hn_id) : [],
  );
  const relatedStories = related.available ? related.value : [];
  return <StoryContent story={story} relatedStories={relatedStories} />;
}

export default withDataFallback(StoryPage);
