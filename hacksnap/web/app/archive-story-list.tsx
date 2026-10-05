import { getArchiveStories } from "../lib/data";
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
}: {
  month: string | null;
  page: number;
  result?: ArchiveResult;
}) {
  const response = await availableData(() =>
    result ? Promise.resolve(result) : getArchiveStories(month, page),
  );
  if (!response.available) return <DataUnavailable />;
  return (
    <StoryFeed
      key={`${archiveURL(month)}:${page}`}
      listingPath={archiveURL(month)}
      initialStories={response.value.stories.map(publicFeedStory)}
      initialPagination={browsePagination(page, response.value.hasNext)}
    />
  );
}
