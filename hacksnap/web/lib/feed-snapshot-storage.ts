import {
  packFeedSnapshot,
  unpackFeedSnapshot,
  validFeedSnapshot,
  validFeedSnapshotRef,
  type FeedSnapshot,
  type FeedSnapshotRef,
} from "./feed-state";

const PREFIX = "hacksnap:feed-snapshot:";
const INDEX_KEY = "hacksnap:feed-snapshot-index";
// UTF-16 is the conservative accounting unit used by Web Storage quotas.
export const MAX_FEED_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_FEED_SNAPSHOT_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 4;
type IndexEntry = { id: string; savedAt: number; bytes: number };
const tabMemory = new WeakMap<Window, Map<string, FeedSnapshot>>();

function memory(): Map<string, FeedSnapshot> {
  let records = tabMemory.get(window);
  if (!records) {
    records = new Map();
    tabMemory.set(window, records);
  }
  return records;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): IndexEntry[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw || raw.length > 2048) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (entry): entry is IndexEntry =>
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        /^[0-9a-f-]{36}$/.test(entry.id) &&
        Number.isFinite(entry.savedAt) &&
        Number.isSafeInteger(entry.bytes) &&
        entry.bytes >= 0 &&
        entry.bytes <= MAX_FEED_SNAPSHOT_BYTES,
    );
  } catch {
    return [];
  }
}

function trimMemory() {
  const records = memory();
  while (records.size > MAX_RECORDS) records.delete(records.keys().next().value!);
}

function writeSnapshot(store: Storage, ref: FeedSnapshotRef, packed: string) {
  const bytes = packed.length * 2;
  if (bytes > MAX_FEED_SNAPSHOT_BYTES) return;
  const old = readIndex(store).filter((entry) => entry.id !== ref.id);
  const keep: IndexEntry[] = [];
  let total = bytes;
  for (const entry of old.sort((a, b) => b.savedAt - a.savedAt)) {
    if (
      Date.now() - entry.savedAt <= 8 * 60 * 60 * 1000 &&
      keep.length < MAX_RECORDS - 1 &&
      total + entry.bytes <= MAX_FEED_SNAPSHOT_TOTAL_BYTES
    ) {
      keep.push(entry);
      total += entry.bytes;
    } else {
      store.removeItem(PREFIX + entry.id);
    }
  }
  try {
    store.setItem(PREFIX + ref.id, packed);
  } catch {
    // A quota failure may be caused by older snapshots owned by this feature.
    for (const entry of keep) store.removeItem(PREFIX + entry.id);
    store.setItem(PREFIX + ref.id, packed);
    keep.length = 0;
  }
  const retained = [{ id: ref.id, savedAt: ref.savedAt, bytes }, ...keep];
  try {
    store.setItem(INDEX_KEY, JSON.stringify(retained));
  } catch {
    store.removeItem(PREFIX + ref.id);
    return;
  }
  const live = new Set(retained.map((entry) => PREFIX + entry.id));
  const orphaned: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key?.startsWith(PREFIX) && !live.has(key)) orphaned.push(key);
  }
  for (const key of orphaned) store.removeItem(key);
}

export function saveFeedSnapshot(
  snapshot: FeedSnapshot,
  previous: unknown,
): FeedSnapshotRef | null {
  const old = validFeedSnapshotRef(previous, snapshot.url);
  const prior = old ? (memory().get(old.id) ?? readFeedSnapshot(old, snapshot.url)) : null;
  // StoryFeed replaces these references when content changes; scroll saves reuse them.
  if (
    old &&
    prior &&
    prior.savedAt === old.contentAt &&
    prior.stories.length === old.storyCount &&
    prior.stories === snapshot.stories &&
    prior.pagination === snapshot.pagination
  ) {
    return positionFeedSnapshot(old, snapshot.url, snapshot.scrollY, snapshot.focusStoryId);
  }
  const continuesSelection =
    prior &&
    prior.stories.length <= snapshot.stories.length &&
    prior.stories.every((story, index) => story.hn_id === snapshot.stories[index].hn_id);
  const id = (continuesSelection ? old?.id : null) ?? window.crypto?.randomUUID?.();
  if (!id) return null;
  const ref: FeedSnapshotRef = {
    version: 2,
    id,
    url: snapshot.url,
    scrollY: snapshot.scrollY,
    focusStoryId: snapshot.focusStoryId,
    savedAt: snapshot.savedAt,
    contentAt: snapshot.savedAt,
    storyCount: snapshot.stories.length,
    pagination: snapshot.pagination,
  };
  memory().delete(id);
  memory().set(id, snapshot);
  trimMemory();
  try {
    writeSnapshot(storage()!, ref, packFeedSnapshot(snapshot));
  } catch {
    // The in-memory copy preserves returns in this tab while storage is denied.
  }
  return ref;
}

export function positionFeedSnapshot(
  value: unknown,
  url: string,
  scrollY: number,
  focusStoryId: string | null,
): FeedSnapshotRef | null {
  const ref = validFeedSnapshotRef(value, url);
  if (!ref) return null;
  return validFeedSnapshotRef({ ...ref, scrollY, focusStoryId, savedAt: Date.now() }, url);
}

export function readFeedSnapshot(value: unknown, url: string): FeedSnapshot | null {
  const ref = validFeedSnapshotRef(value, url);
  if (!ref) return null;
  let snapshot = memory().get(ref.id);
  if (!snapshot) {
    try {
      const raw = storage()?.getItem(PREFIX + ref.id);
      if (raw && raw.length * 2 <= MAX_FEED_SNAPSHOT_BYTES)
        snapshot = unpackFeedSnapshot(raw, url) ?? undefined;
    } catch {
      return null;
    }
  }
  if (!snapshot || snapshot.savedAt < ref.contentAt || snapshot.stories.length < ref.storyCount)
    return null;
  return validFeedSnapshot(
    {
      ...snapshot,
      stories: snapshot.stories.slice(0, ref.storyCount),
      pagination: ref.pagination,
      scrollY: ref.scrollY,
      focusStoryId: ref.focusStoryId,
      savedAt: ref.savedAt,
    },
    url,
  );
}
