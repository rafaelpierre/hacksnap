/** Browser-local history of successful story detail visits. */
export const STORY_HISTORY_KEY = "hacksnap:story-history"; // Shared-map key from versions 1–3.
export const STORY_OPENED_KEY_PREFIX = "hacksnap:story-opened:";
export const STORY_HISTORY_EVENT = "hacksnap:story-history-change";
export const STORY_HISTORY_VERSION = 4;
export const MAX_HISTORY_STORIES = 4000;
const MAX_BYTES = 320 * 1024;
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const STORY_ID = /^[1-9][0-9]{0,14}$/;
const RECORD_PREFIX = "1:";

type Entry = { openedAt: number };
export type StoryHistory = { version: 4; entries: Record<string, Entry> };

const empty = (): StoryHistory => ({ version: 4, entries: {} });
let current = empty();
let pending: Record<string, Entry> = {};
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

function keyFor(id: string) {
  return STORY_OPENED_KEY_PREFIX + id;
}

function encode(openedAt: number) {
  return RECORD_PREFIX + openedAt;
}

function decodeRecord(raw: string | null, now: number): number | null {
  if (!raw?.startsWith(RECORD_PREFIX)) return null;
  const value = Number(raw.slice(RECORD_PREFIX.length));
  return timestamp(value, now) ? value : null;
}

function prune(entries: Record<string, Entry>): StoryHistory {
  const now = Date.now();
  const sorted = Object.entries(entries)
    .filter(([id, entry]) => STORY_ID.test(id) && timestamp(entry.openedAt, now))
    .sort((a, b) => b[1].openedAt - a[1].openedAt || Number(b[0]) - Number(a[0]));
  const kept: Record<string, Entry> = {};
  let bytes = 0;
  let keptCount = 0;
  for (const [id, entry] of sorted) {
    const size = (keyFor(id).length + encode(entry.openedAt).length) * 2;
    if (keptCount >= MAX_HISTORY_STORIES || bytes + size > MAX_BYTES) break;
    kept[id] = entry;
    keptCount++;
    bytes += size;
  }
  return { version: 4, entries: kept };
}

function decodeLegacy(raw: string | null, now: number): Record<string, Entry> {
  if (!raw || raw.length * 2 > MAX_BYTES) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    const record = value as { version?: unknown; entries?: unknown };
    if (
      ![1, 2, 3].includes(record.version as number) ||
      !record.entries ||
      typeof record.entries !== "object" ||
      Array.isArray(record.entries)
    )
      return {};
    const entries: Record<string, Entry> = {};
    for (const [id, item] of Object.entries(record.entries)) {
      if (!STORY_ID.test(id) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const openedAt = (item as { openedAt?: unknown }).openedAt;
      if (timestamp(openedAt, now)) entries[id] = { openedAt };
    }
    return entries;
  } catch {
    return {};
  }
}

function scan(store: Storage) {
  const now = Date.now();
  const entries: Record<string, Entry> = {};
  const observed = new Map<string, string>();
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (!key?.startsWith(STORY_OPENED_KEY_PREFIX)) continue;
    const id = key.slice(STORY_OPENED_KEY_PREFIX.length);
    const raw = store.getItem(key);
    if (raw === null) continue;
    observed.set(id, raw);
    const openedAt = decodeRecord(raw, now);
    if (STORY_ID.test(id) && openedAt !== null) entries[id] = { openedAt };
  }
  return { entries, observed };
}

function removeUnkept(store: Storage, observed: Map<string, string>, kept: StoryHistory) {
  for (const [id, raw] of observed) {
    if (kept.entries[id]) continue;
    const key = keyFor(id);
    try {
      // Avoid deleting a value that another tab changed after this scan.
      if (store.getItem(key) === raw) store.removeItem(key);
    } catch {
      /* A blocked store must not interrupt browsing. */
    }
  }
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new window.Event(STORY_HISTORY_EVENT));
}

function clearStore(store: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key?.startsWith(STORY_OPENED_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
  store.removeItem(STORY_HISTORY_KEY);
}

export function readStoryHistory(): StoryHistory {
  const store = storage();
  if (!store) return current;
  try {
    if (pendingClear) {
      clearStore(store);
      pendingClear = false;
    }
    const { entries, observed } = scan(store);
    const legacy = decodeLegacy(store.getItem(STORY_HISTORY_KEY), Date.now());
    current = prune({ ...legacy, ...entries, ...pending });
    for (const id of Object.keys(pending)) if (!current.entries[id]) delete pending[id];
    removeUnkept(store, observed, current);
    // Each migration write has its own key, so concurrent opens cannot overwrite it.
    let migrationComplete = true;
    for (const [id, entry] of Object.entries(current.entries)) {
      if (observed.has(id) && !pending[id]) continue;
      try {
        store.setItem(keyFor(id), encode(entry.openedAt));
        delete pending[id];
      } catch {
        pending[id] = entry;
        if (legacy[id]) migrationComplete = false;
      }
    }
    if (migrationComplete && store.getItem(STORY_HISTORY_KEY) !== null) {
      try {
        store.removeItem(STORY_HISTORY_KEY);
      } catch {
        /* Valid legacy openings remain readable until removal succeeds. */
      }
    }
  } catch {
    // Keep local memory if reading or clearing storage is blocked.
  }
  return current;
}

export function markStoryOpened(id: string, now = Date.now()) {
  if (!STORY_ID.test(id) || !timestamp(now, now)) return;
  const history = readStoryHistory();
  if (timestamp(history.entries[id]?.openedAt, now)) return;
  current = prune({ ...history.entries, [id]: { openedAt: now } });
  const entry = current.entries[id];
  if (!entry) return;
  pending[id] = entry;
  for (const pendingId of Object.keys(pending))
    if (!current.entries[pendingId]) delete pending[pendingId];
  if (!pendingClear) {
    const store = storage();
    if (store) {
      try {
        store.setItem(keyFor(id), encode(entry.openedAt));
        delete pending[id];
      } catch {
        // The opening remains available in this tab's memory.
      }
    }
  }
  notify();
}

/** Clear only the feature's keys; browser site-data controls provide the UI. */
export function clearStoryHistory() {
  current = empty();
  pending = {};
  pendingClear = true;
  const store = storage();
  if (store) {
    try {
      clearStore(store);
      pendingClear = false;
    } catch {
      /* Memory stays clear until storage is available again. */
    }
  }
  notify();
}

/** Subscribe to same-tab writes and storage changes from another tab. */
export function subscribeStoryHistory(callback: () => void) {
  const sameTab = () => callback();
  const otherTab = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== STORY_HISTORY_KEY &&
      !event.key.startsWith(STORY_OPENED_KEY_PREFIX)
    )
      return;
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
