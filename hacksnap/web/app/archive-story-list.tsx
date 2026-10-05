import Link from "next/link";
import { categoryURL, type Category } from "../lib/categories";
import { getArchiveStories, getCategoryStories } from "../lib/data";
import { availableData } from "../lib/data-availability";
import { archiveURL } from "../lib/archive";
import { browsePagination } from "../lib/browse-feed";
import { publicFeedStory } from "../lib/stories-api";
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
  if (!response.available) return <DataUnavailable />;
  const listingPath = category ? categoryURL(category) : archiveURL(month);
  return (
    <StoryFeed
      key={`${listingPath}:${page}`}
      listingPath={listingPath}
      showCategory={!category}
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
