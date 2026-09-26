import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { storyPreviewMetadata } from "../../../lib/preview-metadata";
import { getRelatedStories, getStory } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { StoryContent } from "./story-content";

export const revalidate = 1800;

export async function generateStaticParams() { return []; }

export async function generateMetadata({params}: {params: Promise<{id: string}>}): Promise<Metadata> {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  return storyPreviewMetadata(story);
}

export default async function StoryPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  const category = categoryById(story.category);
  const relatedStories = category ? await getRelatedStories(category.id, story.hn_id) : [];
  return <StoryContent story={story} relatedStories={relatedStories} />;
}
