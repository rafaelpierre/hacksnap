/** Browser-local encounters. Seen is card exposure; opened is a story visit. */
export const STORY_HISTORY_KEY = "hacksnap:story-history";
export const STORY_HISTORY_EVENT = "hacksnap:story-history-change";
export const STORY_HISTORY_VERSION = 2;
export const MAX_HISTORY_STORIES = 4000;
const MAX_BYTES = 320 * 1024;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const STORY_ID = /^[1-9][0-9]{0,14}$/;

type Entry = { seenAt?: number; openedAt?: number };
export type StoryHistory = { version: 2; entries: Record<string, Entry> };

const empty = (): StoryHistory => ({ version: 2, entries: {} });
let current = empty();
let loaded = false;

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function timestamp(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now &&
    now - value <= MAX_AGE_MS
  );
}

function prune(history: StoryHistory): StoryHistory {
  const now = Date.now();
  const sorted = Object.entries(history.entries)
    .map(
      ([id, entry]) =>
        [
          id,
          {
            seenAt: timestamp(entry.seenAt, now) ? entry.seenAt : undefined,
            openedAt: timestamp(entry.openedAt, now) ? entry.openedAt : undefined,
          },
        ] as const,
    )
    .filter(([, entry]) => entry.seenAt || entry.openedAt)
    .sort(
      (a, b) =>
        Math.max(b[1].seenAt ?? 0, b[1].openedAt ?? 0) -
        Math.max(a[1].seenAt ?? 0, a[1].openedAt ?? 0),
    );
  return { ...history, entries: Object.fromEntries(sorted.slice(0, MAX_HISTORY_STORIES)) };
}

function decode(raw: string | null, now = Date.now()): StoryHistory {
  if (!raw || raw.length * 2 > MAX_BYTES) return empty();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return empty();
    const record = value as { version?: unknown; entries?: unknown };
    if (
      (record.version !== 1 && record.version !== STORY_HISTORY_VERSION) ||
      !record.entries ||
      typeof record.entries !== "object" ||
      Array.isArray(record.entries)
    )
      return empty();
    const entries: Record<string, Entry> = {};
    for (const [id, item] of Object.entries(record.entries)) {
      if (!STORY_ID.test(id) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const candidate = item as { seenAt?: unknown; openedAt?: unknown };
      const entry: Entry = {};
      if (timestamp(candidate.seenAt, now)) entry.seenAt = candidate.seenAt;
      if (timestamp(candidate.openedAt, now)) entry.openedAt = candidate.openedAt;
      if (entry.seenAt || entry.openedAt) entries[id] = entry;
    }
    // Version 1 also saved a Hide seen preference. Ignore it so old data never hides cards.
    return prune({ version: 2, entries });
  } catch {
    return empty();
  }
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new window.Event(STORY_HISTORY_EVENT));
}

function save(next: StoryHistory) {
  current = prune(next);
  loaded = true;
  const store = storage();
  if (store) {
    try {
      let serialized = JSON.stringify(current);
      const idsByRecency = Object.entries(current.entries)
        .sort(
          (a, b) =>
            Math.max(b[1].seenAt ?? 0, b[1].openedAt ?? 0) -
            Math.max(a[1].seenAt ?? 0, a[1].openedAt ?? 0),
        )
        .map(([id]) => id);
      while (serialized.length * 2 > MAX_BYTES && idsByRecency.length) {
        delete current.entries[idsByRecency.pop()!];
        serialized = JSON.stringify(current);
      }
      store.setItem(STORY_HISTORY_KEY, serialized);
    } catch {
      // Memory continues to work in this tab when storage is blocked or full.
    }
  }
  notify();
}

export function readStoryHistory(): StoryHistory {
  if (!loaded) {
    const store = storage();
    if (store) {
      try {
        current = decode(store.getItem(STORY_HISTORY_KEY));
      } catch {
        /* Keep memory state. */
      }
    }
    loaded = true;
  }
  return current;
}

export function markStorySeen(id: string, now = Date.now()) {
  if (!STORY_ID.test(id) || !timestamp(now, now)) return;
  const history = readStoryHistory();
  if (timestamp(history.entries[id]?.seenAt, now)) return;
  save({
    ...history,
    entries: { ...history.entries, [id]: { ...history.entries[id], seenAt: now } },
  });
}

export function markStoryOpened(id: string, now = Date.now()) {
  if (!STORY_ID.test(id) || !timestamp(now, now)) return;
  const history = readStoryHistory();
  if (timestamp(history.entries[id]?.openedAt, now)) return;
  save({
    ...history,
    entries: { ...history.entries, [id]: { ...history.entries[id], openedAt: now } },
  });
}

/** Clear this feature's browser-local timestamps without touching resume or other keys. */
export function clearStoryHistory() {
  save(empty());
}

/** Subscribe to same-tab writes and storage changes from another tab. */
export function subscribeStoryHistory(callback: () => void) {
  const sameTab = () => callback();
  const otherTab = (event: StorageEvent) => {
    if (event.key !== STORY_HISTORY_KEY && event.key !== null) return;
    current = decode(event.newValue);
    loaded = true;
    callback();
  };
  window.addEventListener(STORY_HISTORY_EVENT, sameTab);
  window.addEventListener("storage", otherTab);
  return () => {
    window.removeEventListener(STORY_HISTORY_EVENT, sameTab);
    window.removeEventListener("storage", otherTab);
  };
}

export function emptyStoryHistory(): StoryHistory {
  return empty();
}
