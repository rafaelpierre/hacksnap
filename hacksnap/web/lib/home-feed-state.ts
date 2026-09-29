import { categoryById } from "./categories";
import type { PublicReadyStory } from "./stories-api";

export type HomeFeedPagination = {
  cursor: string | null;
  hasMore: boolean;
  page: number;
  expiresAt: string;
  selectionLimited: boolean;
  previousCursor: string | null;
};

export type HomeFeedSnapshot = {
  version: 1;
  url: string;
  stories: PublicReadyStory[];
  pagination: HomeFeedPagination;
  scrollY: number;
  focusStoryId: string | null;
  savedAt: number;
};

const MAX_STORIES = 400;
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function homePageURL(page: number, cursor: string | null): string {
  if (page <= 1 && !cursor) return "/";
  const query = new URLSearchParams({ page: String(page) });
  if (cursor) query.set("cursor", cursor);
  return `/?${query}`;
}

export function validHomeFeedPage(value: unknown): {
  stories: PublicReadyStory[];
  pagination: HomeFeedPagination;
} | null {
  if (!value || typeof value !== "object") return null;
  const page = value as { stories?: unknown; pagination?: unknown };
  if (!Array.isArray(page.stories) || page.stories.length > 10) return null;
  const snapshot = validHomeFeedSnapshot(
    {
      version: 1,
      url: "/",
      stories: page.stories,
      pagination: page.pagination,
      scrollY: 0,
      focusStoryId: null,
      savedAt: Date.now(),
    },
    "/",
  );
  return snapshot ? { stories: snapshot.stories, pagination: snapshot.pagination } : null;
}

export function appendUniqueStories(
  current: PublicReadyStory[],
  incoming: PublicReadyStory[],
): PublicReadyStory[] {
  const ids = new Set(current.map((story) => story.hn_id));
  return [...current, ...incoming.filter((story) => !ids.has(story.hn_id) && ids.add(story.hn_id))];
}

export function validHomeFeedPagination(value: unknown): HomeFeedPagination | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<HomeFeedPagination>;
  if (
    (page.cursor !== null &&
      (typeof page.cursor !== "string" ||
        page.cursor.length > 6000 ||
        !/^[A-Za-z0-9_-]+$/.test(page.cursor))) ||
    (page.previousCursor !== null &&
      (typeof page.previousCursor !== "string" ||
        page.previousCursor.length > 6000 ||
        !/^[A-Za-z0-9_-]+$/.test(page.previousCursor))) ||
    typeof page.hasMore !== "boolean" ||
    !Number.isSafeInteger(page.page) ||
    !page.page ||
    page.page < 1 ||
    page.page > 10000 ||
    typeof page.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(page.expiresAt)) ||
    typeof page.selectionLimited !== "boolean"
  )
    return null;
  if (page.hasMore && !page.cursor) return null;
  return page as HomeFeedPagination;
}

export function validHomeFeedSnapshot(
  value: unknown,
  url: string,
  now = Date.now(),
): HomeFeedSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<HomeFeedSnapshot>;
  if (
    snapshot.version !== 1 ||
    snapshot.url !== url ||
    !Array.isArray(snapshot.stories) ||
    snapshot.stories.length > MAX_STORIES ||
    !Number.isFinite(snapshot.scrollY) ||
    snapshot.scrollY! < 0 ||
    !Number.isFinite(snapshot.savedAt) ||
    snapshot.savedAt! > now ||
    now - snapshot.savedAt! > MAX_AGE_MS ||
    (snapshot.focusStoryId !== null &&
      (typeof snapshot.focusStoryId !== "string" ||
        !/^[1-9][0-9]{0,14}$/.test(snapshot.focusStoryId)))
  )
    return null;
  const pagination = validHomeFeedPagination(snapshot.pagination);
  if (!pagination) return null;
  const ids = new Set<string>();
  const stories: PublicReadyStory[] = [];
  for (const value of snapshot.stories) {
    if (!value || typeof value !== "object") return null;
    const story = value as PublicReadyStory;
    const coverage = story.summary?.source_coverage;
    if (
      typeof story.hn_id !== "string" ||
      !/^[1-9][0-9]{0,14}$/.test(story.hn_id) ||
      ids.has(story.hn_id) ||
      typeof story.title !== "string" ||
      !Number.isSafeInteger(story.points) ||
      story.points < 0 ||
      !Number.isSafeInteger(story.comment_count) ||
      story.comment_count < 0 ||
      (story.story_slug !== null && typeof story.story_slug !== "string") ||
      (story.category !== null && !categoryById(story.category)) ||
      typeof story.url !== "string" ||
      typeof story.is_recent !== "boolean" ||
      typeof story.rank !== "string" ||
      !/^[1-9][0-9]{0,14}$/.test(story.rank) ||
      !Array.isArray(story.rank_history) ||
      story.rank_history.length > 168 ||
      story.rank_history.some(
        (point) =>
          !point ||
          !Number.isFinite(Date.parse(point.observed_at)) ||
          !Number.isSafeInteger(point.rank) ||
          point.rank < 1,
      ) ||
      typeof story.summary?.overall_takeaway !== "string" ||
      !story.summary.overall_takeaway.trim() ||
      ![-1, 0, 1, null].includes(story.summary.sentiment) ||
      !coverage ||
      !Number.isSafeInteger(coverage.stored_comments) ||
      coverage.stored_comments < 0 ||
      !Number.isSafeInteger(coverage.included_comments) ||
      coverage.included_comments < 0 ||
      typeof coverage.comments_truncated !== "boolean" ||
      !["fetched", "unavailable", "not_applicable"].includes(coverage.article_status) ||
      (coverage.sentiment !== undefined &&
        (!coverage.sentiment ||
          !Number.isSafeInteger(coverage.sentiment.included_comments) ||
          coverage.sentiment.included_comments < 0))
    )
      return null;
    ids.add(story.hn_id);
    if (!Number.isFinite(Date.parse(story.date_added))) return null;
    stories.push(story);
  }
  if (snapshot.focusStoryId && !ids.has(snapshot.focusStoryId)) return null;
  return { ...snapshot, stories, pagination } as HomeFeedSnapshot;
}
