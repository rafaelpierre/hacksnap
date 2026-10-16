import { storyIdFromSlug, storyPath } from "../../../lib/story-url";
import { availableData } from "../../../lib/data-availability";
import { withDataFallback } from "../../with-data-fallback";
import { connection } from "next/server";
import { storyISREnabled, trackUnpublishedForISR } from "../../../lib/publication-cache";
import { hasReadySummary } from "../../../lib/ready-stories";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { storyPreviewMetadata } from "../../../lib/preview-metadata";
import { getRelatedStories, getStory, getFreshStory } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { StoryContent } from "./story-content";
import { RelatedStories } from "../../related-stories";
import { BrowseLayout } from "../../topic-sidebar";
import { Suspense } from "react";
import type { Category } from "../../../lib/categories";

async function loadStory(id: string, requestTime = false) {
  if (!storyISREnabled() || requestTime) {
    await connection();
    return getStory(id);
  }
  const story = await getFreshStory(id);
  if (!story || !hasReadySummary(story)) await trackUnpublishedForISR();
  return story;
}

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
      unavailable={!result.available}
      currentId={currentId}
    />
  );
}

export async function generateMetadata({
  params,
  requestTime,
}: {
  params: Promise<{ id: string }>;
  requestTime?: boolean;
}): Promise<Metadata> {
  const { id: slug } = await params;
  const id = storyIdFromSlug(slug);
  if (!id) notFound();
  // Throw during ISR regeneration so Next retains the successful old response.
  if (storyISREnabled() && !requestTime) {
    const story = await loadStory(id);
    if (!story) notFound();
    return storyPreviewMetadata(story);
  }
  const result = await availableData(() => loadStory(id, requestTime));
  if (!result.available)
    return { title: "Story temporarily unavailable", robots: { index: false } };
  if (!result.value) notFound();
  return storyPreviewMetadata(result.value);
}

export type StoryRouteProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function StoryPage({
  params,
  searchParams,
  requestTime,
}: StoryRouteProps & { requestTime?: boolean }) {
  const { id: slug } = await params;
  const id = storyIdFromSlug(slug);
  if (!id) notFound();
  const story = await loadStory(id, requestTime);
  if (!story) notFound();
  const canonical = storyPath(story.hn_id, story.story_slug);
  if (`/story/${slug}` !== canonical) {
    const query = new URLSearchParams();
    const queryValues = !storyISREnabled() || requestTime ? ((await searchParams) ?? {}) : {};
    for (const [key, value] of Object.entries(queryValues)) {
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

const DynamicStoryPage = withDataFallback(StoryPage);
export default async function Page(props: Parameters<typeof StoryPage>[0]) {
  return storyISREnabled() && !props.requestTime ? StoryPage(props) : DynamicStoryPage(props);
}
