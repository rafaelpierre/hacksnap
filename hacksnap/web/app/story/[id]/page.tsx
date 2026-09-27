import { availableData } from "../../../lib/data-availability";
import { withDataFallback } from "../../with-data-fallback";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
  const { id } = await params;
  const result = await availableData(() => getStory(id));
  if (!result.available)
    return { title: "Story temporarily unavailable", robots: { index: false } };
  if (!result.value) notFound();
  return storyPreviewMetadata(result.value);
}

async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await getStory(id);
  if (!story) notFound();
  const category = categoryById(story.category);
  const related = await availableData(async () =>
    category ? getRelatedStories(category.id, story.hn_id) : [],
  );
  const relatedStories = related.available ? related.value : [];
  return <StoryContent story={story} relatedStories={relatedStories} />;
}

export default withDataFallback(StoryPage);
