import { storyIdFromSlug, storyPath } from "../../../lib/story-url";
import { availableData } from "../../../lib/data-availability";
import { withDataFallback } from "../../with-data-fallback";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { storyPreviewMetadata } from "../../../lib/preview-metadata";
import { getRelatedStories, getStory } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { StoryContent } from "./story-content";
import { RelatedStories } from "../../related-stories";
import { BrowseLayout } from "../../topic-sidebar";
import { Suspense } from "react";
import type { Category } from "../../../lib/categories";

export const dynamic = "force-dynamic";

async function StoryRecommendations({
  category,
  currentId,
}: {
  category: Category;
  currentId: string;
}) {
  const result = await availableData(() => getRelatedStories(category.id, currentId));
  return (
    <RelatedStories
      category={category}
      stories={result.available ? result.value : []}
      currentId={currentId}
    />
  );
}

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
  const canonical = storyPath(story.hn_id, story.story_slug);
  if (`/story/${slug}` !== canonical) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
        query.append(key, entry);
    }
    permanentRedirect(canonical + (query.size ? `?${query}` : ""));
  }
  const category = categoryById(story.category);
  return (
    <BrowseLayout>
      <StoryContent
        story={story}
        relatedSection={
          category ? (
            <Suspense
              fallback={
                <RelatedStories category={category} stories={[]} currentId={story.hn_id} pending />
              }
            >
              <StoryRecommendations category={category} currentId={story.hn_id} />
            </Suspense>
          ) : (
            <RelatedStories stories={[]} currentId={story.hn_id} />
          )
        }
      />
    </BrowseLayout>
  );
}

export default withDataFallback(StoryPage);
