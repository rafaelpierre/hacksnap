import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import { getArchiveStories, getCategoryStories, getStory } from "../lib/data";
import { availableData } from "../lib/data-availability";
import { archiveURL } from "../lib/archive";
import { browsePagination } from "../lib/browse-feed";
import { publicFeedStory } from "../lib/stories-api";
import { readLeadDiscussionPreview } from "../lib/feed-presentation";
import { StoryFeed } from "./story-feed";
import { DataUnavailable } from "./data-unavailable";

type ArchiveResult = Awaited<ReturnType<typeof getArchiveStories>>;

export async function ArchiveStoryList({
  month,
  page,
  result,
  category,
}: {
  month: string | null;
  page: number;
  result?: ArchiveResult;
  category?: Category | null;
}) {
  const response = await availableData(() =>
    result
      ? Promise.resolve(result)
      : category
        ? getCategoryStories(category.id, page)
        : getArchiveStories(month, page),
  );
  if (!response.available) return <DataUnavailable headingLevel={2} />;
  const listingPath = category ? categoryURL(category) : archiveURL(month);
  const leadStoryId = response.value.stories[0]?.hn_id ?? null;
  const preview = await readLeadDiscussionPreview(leadStoryId, getStory);
  return (
    <StoryFeed
      key={`${listingPath}:${page}`}
      listingPath={listingPath}
      leadStoryId={leadStoryId}
      discussionPreview={preview}
      initialStories={response.value.stories.map(publicFeedStory)}
      initialPagination={browsePagination(page, response.value.hasNext)}
      emptyState={
        category ? (
          <div className="empty">
            <h2>No stories in this topic yet.</h2>
            <p>New stories will appear here as they’re added.</p>
            <Link className="button" href="/">
              Browse latest stories
            </Link>
          </div>
        ) : undefined
      }
    />
  );
}
