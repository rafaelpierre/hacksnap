import { validHomeFeedSnapshot, type HomeFeedSnapshot } from "./home-feed-state";

export const HOME_FEED_CHECKPOINT_KEY = "hacksnap:home-feed-checkpoint";

const RECENT_AGE_MS = 30 * 60 * 1000;
const MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;
const MAX_SCROLL_OFFSET = 10_000_000;
const STORY_ID = /^[1-9][0-9]{0,14}$/;

export type HomeFeedCheckpoint = {
  version: 1;
  snapshot: HomeFeedSnapshot;
  anchor: { storyId: string; offset: number } | null;
};

type CheckpointStatus = "recent" | "older" | "expired";

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function validAnchor(
  value: unknown,
  snapshot: HomeFeedSnapshot,
): { storyId: string; offset: number } | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const anchor = value as { storyId?: unknown; offset?: unknown };
  if (
    typeof anchor.storyId !== "string" ||
    !STORY_ID.test(anchor.storyId) ||
    !snapshot.stories.some((story) => story.hn_id === anchor.storyId) ||
    typeof anchor.offset !== "number" ||
    !Number.isFinite(anchor.offset) ||
    Math.abs(anchor.offset) > MAX_SCROLL_OFFSET
  )
    return undefined;
  return { storyId: anchor.storyId, offset: anchor.offset };
}

function validCheckpoint(value: unknown, now: number): HomeFeedCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const checkpoint = value as Partial<HomeFeedCheckpoint>;
  if (checkpoint.version !== 1 || !checkpoint.snapshot || typeof checkpoint.snapshot !== "object")
    return null;

  const savedAt = (checkpoint.snapshot as { savedAt?: unknown }).savedAt;
  if (
    typeof savedAt !== "number" ||
    !Number.isSafeInteger(savedAt) ||
    savedAt < 0 ||
    savedAt > now ||
    now - savedAt > MAX_RETENTION_MS
  )
    return null;

  // The regular history snapshot has an eight-hour lifetime. Validate the
  // checkpoint against its own timestamp, then apply its separate retention
  // window above.
  const snapshot = validHomeFeedSnapshot(checkpoint.snapshot, "/", savedAt);
  if (!snapshot) return null;
  const anchor = validAnchor(checkpoint.anchor, snapshot);
  if (anchor === undefined) return null;
  return {
    version: 1,
    snapshot: {
      version: 1,
      url: "/",
      stories: snapshot.stories,
      pagination: {
        cursor: snapshot.pagination.cursor,
        hasMore: snapshot.pagination.hasMore,
        page: snapshot.pagination.page,
        expiresAt: snapshot.pagination.expiresAt,
        selectionLimited: snapshot.pagination.selectionLimited,
        previousCursor: snapshot.pagination.previousCursor,
      },
      scrollY: snapshot.scrollY,
      focusStoryId: snapshot.focusStoryId,
      savedAt: snapshot.savedAt,
    },
    anchor,
  };
}

function isRootHomeURL(url: string): boolean {
  return url === "/";
}

export function readHomeFeedCheckpoint(
  url: string,
  now = Date.now(),
): { checkpoint: HomeFeedCheckpoint; status: CheckpointStatus } | null {
  if (!isRootHomeURL(url) || !Number.isSafeInteger(now)) return null;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(HOME_FEED_CHECKPOINT_KEY);
    if (typeof raw !== "string" || raw.length * 2 > MAX_SERIALIZED_BYTES) return null;
    const checkpoint = validCheckpoint(JSON.parse(raw), now);
    if (!checkpoint) return null;
    const expiresAt = Date.parse(checkpoint.snapshot.pagination.expiresAt);
    const status: CheckpointStatus =
      expiresAt <= now
        ? "expired"
        : now - checkpoint.snapshot.savedAt <= RECENT_AGE_MS
          ? "recent"
          : "older";
    return { checkpoint, status };
  } catch {
    return null;
  }
}

export function saveHomeFeedCheckpoint(checkpoint: HomeFeedCheckpoint): boolean {
  const now = Date.now();
  const validated = Number.isSafeInteger(now) ? validCheckpoint(checkpoint, now) : null;
  if (!validated) return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(validated);
  } catch {
    return false;
  }
  if (serialized.length * 2 > MAX_SERIALIZED_BYTES) return false;
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(HOME_FEED_CHECKPOINT_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearHomeFeedCheckpoint(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(HOME_FEED_CHECKPOINT_KEY);
    return true;
  } catch {
    return false;
  }
}
