/** Browser-local history of successful story detail visits. */
export const STORY_HISTORY_KEY = "hacksnap:story-history";
export const STORY_HISTORY_EVENT = "hacksnap:story-history-change";
export const STORY_HISTORY_VERSION = 3;
export const MAX_HISTORY_STORIES = 4000;
const MAX_BYTES = 320 * 1024;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const STORY_ID = /^[1-9][0-9]{0,14}$/;

type Entry = { openedAt: number };
export type StoryHistory = { version: 3; entries: Record<string, Entry> };

const empty = (): StoryHistory => ({ version: 3, entries: {} });
let current = empty();
let dirty = false;
let pendingClear = false;

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
    .filter(([, entry]) => timestamp(entry.openedAt, now))
    .sort((a, b) => b[1].openedAt - a[1].openedAt);
  return { version: 3, entries: Object.fromEntries(sorted.slice(0, MAX_HISTORY_STORIES)) };
}

function decode(raw: string | null, now = Date.now()): StoryHistory {
  if (!raw || raw.length * 2 > MAX_BYTES) return empty();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return empty();
    const record = value as { version?: unknown; entries?: unknown };
    if (
      ![1, 2, STORY_HISTORY_VERSION].includes(record.version as number) ||
      !record.entries ||
      typeof record.entries !== "object" ||
      Array.isArray(record.entries)
    )
      return empty();
    const entries: Record<string, Entry> = {};
    for (const [id, item] of Object.entries(record.entries)) {
      if (!STORY_ID.test(id) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const openedAt = (item as { openedAt?: unknown }).openedAt;
      if (timestamp(openedAt, now)) entries[id] = { openedAt };
    }
    // Earlier versions also recorded feed exposure and a Hide seen preference.
    return prune({ version: 3, entries });
  } catch {
    return empty();
  }
}

function merge(local: StoryHistory, persisted: StoryHistory): StoryHistory {
  return prune({ version: 3, entries: { ...persisted.entries, ...local.entries } });
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new window.Event(STORY_HISTORY_EVENT));
}

function save(next: StoryHistory) {
  current = prune(next);
  const store = storage();
  if (store) {
    try {
      let serialized = JSON.stringify(current);
      const idsByRecency = Object.entries(current.entries)
        .sort((a, b) => b[1].openedAt - a[1].openedAt)
        .map(([id]) => id);
      while (serialized.length * 2 > MAX_BYTES && idsByRecency.length) {
        delete current.entries[idsByRecency.pop()!];
        serialized = JSON.stringify(current);
      }
      store.setItem(STORY_HISTORY_KEY, serialized);
      dirty = false;
      pendingClear = false;
    } catch {
      dirty = true;
      // Memory continues to work in this tab when storage is blocked or full.
    }
  } else dirty = true;
  notify();
}

export function readStoryHistory(): StoryHistory {
  const store = storage();
  if (store) {
    try {
      // Re-read even after initialization: another tab may have written while this
      // tab had no mounted feed subscription.
      const persisted = decode(store.getItem(STORY_HISTORY_KEY));
      current = pendingClear ? current : dirty ? merge(current, persisted) : persisted;
    } catch {
      /* Keep memory state. */
    }
  }
  return current;
}

export function markStoryOpened(id: string, now = Date.now()) {
  if (!STORY_ID.test(id) || !timestamp(now, now)) return;
  const history = readStoryHistory();
  if (timestamp(history.entries[id]?.openedAt, now)) return;
  save({ version: 3, entries: { ...history.entries, [id]: { openedAt: now } } });
}

/** Clear this feature's browser-local timestamps without touching resume or other keys. */
export function clearStoryHistory() {
  pendingClear = true;
  save(empty());
}

/** Subscribe to same-tab writes and storage changes from another tab. */
export function subscribeStoryHistory(callback: () => void) {
  const sameTab = () => callback();
  const otherTab = (event: StorageEvent) => {
    if (event.key !== STORY_HISTORY_KEY && event.key !== null) return;
    const persisted = decode(event.newValue);
    current = pendingClear ? current : dirty ? merge(current, persisted) : persisted;
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
