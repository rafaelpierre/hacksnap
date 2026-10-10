import type { PublicFeedStory } from "../../lib/stories-api";
import type { FeedPagination } from "../../lib/feed-state";

export type FeedState = {
  leadStoryId: string | null;
  stories: PublicFeedStory[];
  pagination: FeedPagination;
  phase: "idle" | "loading" | "failed";
  announcement: string;
};
