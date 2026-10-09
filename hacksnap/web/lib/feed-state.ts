import { browseLabel, normalizedBrowseURL } from "./navigation-context";
import { ARCHIVE_PAGE_SIZE, MAX_BROWSE_PAGE } from "./archive";
import { categoryById } from "./categories";
import { hasPublishedTakeaway } from "./ready-stories";
import type { PublicFeedStory } from "./stories-api";

export type FeedPagination = {
  cursor: string | null;
  hasMore: boolean;
  page: number;
  // Browse offsets depend on batch size. Older snapshots cannot safely resume
  // after a batch-size change, even when every saved card already has a brief.
  pageSize?: number;
  expiresAt: string | null;
  selectionLimited: boolean;
  previousCursor: string | null;
};

export type FeedSnapshot = {
  version: 1;
  leadStoryId?: string | null;
  url: string;
  stories: PublicFeedStory[];
  pagination: FeedPagination;
  scrollY: number;
  focusStoryId: string | null;
  savedAt: number;
};

export type FeedSnapshotRef = {
  version: 2;
  id: string;
  url: string;
  scrollY: number;
  focusStoryId: string | null;
  savedAt: number;
  contentAt: number;
  storyCount: number;
  pagination: FeedPagination;
};

const SNAPSHOT_ID = /^[0-9a-f-]{36}$/;

export function validFeedSnapshotRef(
  value: unknown,
  url: string,
  now = Date.now(),
): FeedSnapshotRef | null {
  if (!value || typeof value !== "object") return null;
  const ref = value as Partial<FeedSnapshotRef>;
  const normalizedURL = normalizedBrowseURL(url);
  if (!normalizedURL || typeof ref.url !== "string") return null;
  return ref.version === 2 &&
    typeof ref.id === "string" &&
    SNAPSHOT_ID.test(ref.id) &&
    normalizedBrowseURL(ref.url) === normalizedURL &&
    typeof ref.scrollY === "number" &&
    Number.isFinite(ref.scrollY) &&
    ref.scrollY >= 0 &&
    (ref.focusStoryId === null ||
      (typeof ref.focusStoryId === "string" && /^[1-9][0-9]{0,14}$/.test(ref.focusStoryId))) &&
    typeof ref.savedAt === "number" &&
    Number.isFinite(ref.savedAt) &&
    typeof ref.contentAt === "number" &&
    Number.isFinite(ref.contentAt) &&
    ref.contentAt <= ref.savedAt &&
    Number.isSafeInteger(ref.storyCount) &&
    ref.storyCount! >= 0 &&
    ref.storyCount! <= ARCHIVE_PAGE_SIZE * MAX_BROWSE_PAGE &&
    !!browseLabel(url) &&
    !!validFeedPagination(ref.pagination) &&
    ref.savedAt <= now &&
    now - ref.savedAt <= MAX_AGE_MS
    ? ({ ...ref, url: normalizedURL } as FeedSnapshotRef)
    : null;
}

// The public card contract is fixed here. Positional fields remove repeated key
// names from deep feed snapshots without dropping any rendered card data.
export function packFeedSnapshot(snapshot: FeedSnapshot): string {
  return JSON.stringify([
    2,
    snapshot.url,
    snapshot.stories.map((story) => [
      story.hn_id,
      story.story_slug,
      story.title,
      story.category,
      story.url,
      story.points,
      story.comment_count,
      story.date_added,
      story.rank,
      story.is_recent,
      story.rank_history.map((point) => [point.observed_at, point.rank]),
      story.image_url,
      story.image_status,
      story.image_width,
      story.image_height,
      story.image_mime_type,
      story.summary
        ? [
            story.summary.overall_takeaway,
            story.summary.sentiment,
            story.summary.source_coverage
              ? [
                  story.summary.source_coverage.stored_comments,
                  story.summary.source_coverage.included_comments,
                  story.summary.source_coverage.comments_truncated,
                  story.summary.source_coverage.article_status,
                  story.summary.source_coverage.sentiment?.included_comments ?? null,
                ]
              : null,
            story.summary.discussion_preview ?? null,
          ]
        : null,
    ]),
    snapshot.pagination,
    snapshot.scrollY,
    snapshot.focusStoryId,
    snapshot.savedAt,
    ...(snapshot.leadStoryId === undefined ? [] : [snapshot.leadStoryId]),
  ]);
}

export function unpackFeedSnapshot(raw: string, url: string): FeedSnapshot | null {
  try {
    const packed: unknown = JSON.parse(raw);
    if (!Array.isArray(packed) || ![7, 8].includes(packed.length) || packed[0] !== 2) return null;
    const [, savedURL, rows, pagination, scrollY, focusStoryId, savedAt, leadStoryId] = packed;
    if (!Array.isArray(rows)) return null;
    const stories = rows.map((value: unknown) => {
      if (!Array.isArray(value) || value.length !== 17) return null;
      const history = value[10];
      const summary = value[16];
      if (
        !Array.isArray(history) ||
        history.some((point) => !Array.isArray(point) || point.length !== 2)
      )
        return null;
      if (summary !== null && (!Array.isArray(summary) || ![3, 4].includes(summary.length)))
        return null;
      const coverage = summary?.[2];
      if (
        coverage !== null &&
        coverage !== undefined &&
        (!Array.isArray(coverage) || coverage.length !== 5)
      )
        return null;
      return {
        hn_id: value[0],
        story_slug: value[1],
        title: value[2],
        category: value[3],
        url: value[4],
        points: value[5],
        comment_count: value[6],
        date_added: value[7],
        rank: value[8],
        is_recent: value[9],
        rank_history: history.map((point) => ({ observed_at: point[0], rank: point[1] })),
        image_url: value[11],
        image_status: value[12],
        image_width: value[13],
        image_height: value[14],
        image_mime_type: value[15],
        summary:
          summary === null
            ? null
            : {
                overall_takeaway: summary[0],
                sentiment: summary[1],
                ...(summary[3] == null ? {} : { discussion_preview: summary[3] }),
                source_coverage:
                  coverage === null
                    ? null
                    : {
                        stored_comments: coverage[0],
                        included_comments: coverage[1],
                        comments_truncated: coverage[2],
                        article_status: coverage[3],
                        ...(coverage[4] === null
                          ? {}
                          : { sentiment: { included_comments: coverage[4] } }),
                      },
              },
      };
    });
    if (stories.includes(null)) return null;
    return validFeedSnapshot(
      {
        version: 1,
        url: savedURL,
        stories,
        pagination,
        scrollY,
        focusStoryId,
        savedAt,
        ...(leadStoryId === undefined ? {} : { leadStoryId }),
      },
      url,
    );
  } catch {
    return null;
  }
}

const MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function validFeedPage(
  value: unknown,
  url = "/",
): {
  stories: PublicFeedStory[];
  pagination: FeedPagination;
} | null {
  if (!value || typeof value !== "object") return null;
  const page = value as { stories?: unknown; pagination?: unknown };
  if (!Array.isArray(page.stories) || page.stories.length > ARCHIVE_PAGE_SIZE) return null;
  const snapshot = validFeedSnapshot(
    {
      version: 1,
      url,
      stories: page.stories,
      pagination: page.pagination,
      scrollY: 0,
      focusStoryId: null,
      savedAt: Date.now(),
    },
    url,
  );
  return snapshot ? { stories: snapshot.stories, pagination: snapshot.pagination } : null;
}

export function appendUniqueStories(
  current: PublicFeedStory[],
  incoming: PublicFeedStory[],
): PublicFeedStory[] {
  const ids = new Set(current.map((story) => story.hn_id));
  return [...current, ...incoming.filter((story) => !ids.has(story.hn_id) && ids.add(story.hn_id))];
}

export function validFeedPagination(value: unknown): FeedPagination | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<FeedPagination>;
  if (
    page.cursor !== null ||
    page.previousCursor !== null ||
    typeof page.hasMore !== "boolean" ||
    !Number.isSafeInteger(page.page) ||
    !page.page ||
    page.page < 1 ||
    page.page > MAX_BROWSE_PAGE ||
    page.expiresAt !== null ||
    page.pageSize !== ARCHIVE_PAGE_SIZE ||
    typeof page.selectionLimited !== "boolean"
  )
    return null;
  return page as FeedPagination;
}

export function validFeedSnapshot(
  value: unknown,
  url: string,
  now = Date.now(),
): FeedSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<FeedSnapshot>;
  const normalizedURL = normalizedBrowseURL(url);
  if (!normalizedURL || typeof snapshot.url !== "string") return null;
  if (
    snapshot.version !== 1 ||
    normalizedBrowseURL(snapshot.url) !== normalizedURL ||
    !Array.isArray(snapshot.stories) ||
    snapshot.stories.length > ARCHIVE_PAGE_SIZE * MAX_BROWSE_PAGE ||
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
  if (!browseLabel(url)) return null;
  const pagination = validFeedPagination(snapshot.pagination);
  if (!pagination) return null;
  const ids = new Set<string>();
  const stories: PublicFeedStory[] = [];
  for (const value of snapshot.stories) {
    if (!value || typeof value !== "object") return null;
    const story = value as PublicFeedStory;
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
      (story.image_url !== null && typeof story.image_url !== "string") ||
      (story.image_status !== null && story.image_status !== "ready") ||
      (story.image_width !== null &&
        (!Number.isSafeInteger(story.image_width) || story.image_width < 1)) ||
      (story.image_height !== null &&
        (!Number.isSafeInteger(story.image_height) || story.image_height < 1)) ||
      (story.image_mime_type !== null && typeof story.image_mime_type !== "string") ||
      typeof story.is_recent !== "boolean" ||
      (story.rank !== null &&
        (typeof story.rank !== "string" || !/^[1-9][0-9]{0,14}$/.test(story.rank))) ||
      !Array.isArray(story.rank_history) ||
      story.rank_history.length > 168 ||
      story.rank_history.some(
        (point) =>
          !point ||
          !Number.isFinite(Date.parse(point.observed_at)) ||
          !Number.isSafeInteger(point.rank) ||
          point.rank < 1,
      ) ||
      !story.summary ||
      !hasPublishedTakeaway(story.summary.overall_takeaway) ||
      (story.summary.discussion_preview != null &&
        (typeof story.summary.discussion_preview !== "string" ||
          story.summary.discussion_preview.length > 220)) ||
      ![-1, 0, 1, null].includes(story.summary.sentiment) ||
      (coverage !== null &&
        (!coverage ||
          !Number.isSafeInteger(coverage.stored_comments) ||
          coverage.stored_comments < 0 ||
          !Number.isSafeInteger(coverage.included_comments) ||
          coverage.included_comments < 0 ||
          typeof coverage.comments_truncated !== "boolean" ||
          !["fetched", "unavailable", "not_applicable"].includes(coverage.article_status) ||
          (coverage.sentiment !== undefined &&
            (!coverage.sentiment ||
              !Number.isSafeInteger(coverage.sentiment.included_comments) ||
              coverage.sentiment.included_comments < 0))))
    )
      return null;
    ids.add(story.hn_id);
    if (!Number.isFinite(Date.parse(story.date_added))) return null;
    stories.push(story);
  }
  if (snapshot.focusStoryId && !ids.has(snapshot.focusStoryId)) return null;
  if (
    snapshot.leadStoryId !== undefined &&
    snapshot.leadStoryId !== null &&
    (typeof snapshot.leadStoryId !== "string" || snapshot.leadStoryId !== stories[0]?.hn_id)
  )
    return null;
  return { ...snapshot, url: normalizedURL, stories, pagination } as FeedSnapshot;
}
