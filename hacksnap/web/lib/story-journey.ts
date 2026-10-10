import { browseLabel, validBrowseContext, type BrowseContext } from "./navigation-context";
import {
  validFeedSnapshot,
  validFeedSnapshotRef,
  type FeedSnapshot,
  type FeedSnapshotRef,
} from "./feed-state";
import { positionFeedSnapshot, readFeedSnapshot, saveFeedSnapshot } from "./feed-snapshot-storage";

const PREFIX = "hacksnap:journey:";
const RESTORE_KEY = "hacksnap:pending-return";
const TAB_PREFIX = "hacksnap-tab:";
const HISTORY_KEY = "hacksnapJourney";
const HISTORY_CONTEXT_KEY = "hacksnapBrowseContext";
const HOME_HISTORY_KEY = "hacksnapHomeFeed";
// Keep at most 40 journey records per tab and discard records older than eight
// hours. Cleanup only touches keys owned by this feature.
const MAX_JOURNEY_RECORDS = 40;
const JOURNEY_MAX_AGE_MS = 8 * 60 * 60 * 1000;
// router.push has no state argument. Hand off the token in memory until the
// destination commits, then attach it to that entry without changing its URL.
let pendingJourney: {
  href: string;
  token: string | null;
  context: BrowseContext | null;
  homeFeedRef: FeedSnapshotRef | null;
} | null = null;
let pendingHomeReturn: { context: BrowseContext; homeFeedRef: FeedSnapshotRef } | null = null;
let pendingListReturn: BrowseContext | null = null;
let memoryTabId: string | null = null;
const memoryJourneys = new Map<
  string,
  { context: BrowseContext | null; homeFeedRef: FeedSnapshotRef | null }
>();

export function cancelPendingJourney() {
  pendingJourney = null;
  window.removeEventListener("popstate", cancelPendingJourney);
}

export function prepareJourney(
  href: string,
  token: string | null,
  context: BrowseContext | null = null,
  homeFeedRef: FeedSnapshotRef | null = null,
) {
  pendingJourney = { href, token, context, homeFeedRef };
  window.addEventListener("popstate", cancelPendingJourney);
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function currentTabId(): string | null {
  try {
    if (window.name.startsWith(TAB_PREFIX)) memoryTabId = window.name;
  } catch {
    // The same-tab memory fallback does not depend on window.name.
  }
  return memoryTabId;
}

function ensureTabId(): string | null {
  const existing = currentTabId();
  if (existing) return existing;
  try {
    if (typeof window.crypto?.randomUUID !== "function") return null;
    memoryTabId = TAB_PREFIX + window.crypto.randomUUID();
    try {
      window.name = memoryTabId;
    } catch {
      // window.name is only needed to carry identity across navigation.
    }
    return memoryTabId;
  } catch {
    return null;
  }
}

function cleanupJourneyStorage(store: Storage) {
  try {
    const records: Array<{ key: string; savedAt: number }> = [];
    const journeyKeys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      journeyKeys.push(key);
    }
    for (const key of journeyKeys) {
      let savedAt = 0;
      try {
        const record = JSON.parse(store.getItem(key) ?? "null");
        const context = validBrowseContext(record?.context);
        savedAt = context?.savedAt ?? 0;
      } catch {
        // Malformed records cannot be used for a return.
      }
      if (Date.now() - savedAt > JOURNEY_MAX_AGE_MS) {
        try {
          store.removeItem(key);
        } catch {
          return;
        }
      } else {
        records.push({ key, savedAt });
      }
    }
    records.sort((a, b) => b.savedAt - a.savedAt);
    for (const { key } of records.slice(MAX_JOURNEY_RECORDS)) {
      try {
        store.removeItem(key);
      } catch {
        return;
      }
    }
  } catch {
    // Storage is optional and may be partially blocked by browser policy.
  }
}

function cleanupMemoryJourneys() {
  const records = [...memoryJourneys.entries()]
    .filter(([, record]) => {
      const savedAt = record.context?.savedAt ?? 0;
      return Date.now() - savedAt <= JOURNEY_MAX_AGE_MS;
    })
    .sort((a, b) => (b[1].context?.savedAt ?? 0) - (a[1].context?.savedAt ?? 0));
  memoryJourneys.clear();
  for (const [token, record] of records.slice(0, MAX_JOURNEY_RECORDS)) {
    memoryJourneys.set(token, record);
  }
}

export function readJourney(token: string | null): BrowseContext | null {
  const fromHistory = validBrowseContext(window.history.state?.[HISTORY_CONTEXT_KEY]);
  if (fromHistory && window.history.state?.[HISTORY_KEY] === token) return fromHistory;
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) return null;
  const memory = memoryJourneys.get(token);
  if (memory) return validBrowseContext(memory.context);
  const store = storage();
  const tabId = currentTabId();
  if (!store || !tabId) return null;
  try {
    const record = JSON.parse(store.getItem(PREFIX + token) ?? "null");
    return record?.tabId === tabId ? validBrowseContext(record.context) : null;
  } catch {
    return null;
  }
}

export function readJourneyHomeFeedRef(token: string | null, url: string): FeedSnapshotRef | null {
  const state = window.history.state;
  if (state?.[HISTORY_KEY] === token) {
    const fromHistory = validFeedSnapshotRef(state?.[HOME_HISTORY_KEY], url);
    if (fromHistory) return fromHistory;
  }
  if (!token) return null;
  const fromMemory = validFeedSnapshotRef(memoryJourneys.get(token)?.homeFeedRef, url);
  if (fromMemory) return fromMemory;
  try {
    const record = JSON.parse(storage()?.getItem(PREFIX + token) ?? "null");
    return record?.tabId === currentTabId() ? validFeedSnapshotRef(record?.homeFeedRef, url) : null;
  } catch {
    return null;
  }
}

function readJourneyHomeFeed(token: string | null, url: string): FeedSnapshot | null {
  const ref = readJourneyHomeFeedRef(token, url);
  if (ref) return readFeedSnapshot(ref, url);
  const state = window.history.state;
  const fromHistory = validFeedSnapshot(state?.[HOME_HISTORY_KEY], url);
  if (fromHistory) return fromHistory;
  if (!token) return null;
  const store = storage();
  try {
    const record = JSON.parse(store?.getItem(PREFIX + token) ?? "null");
    if (record?.tabId !== currentTabId()) return null;
    return validFeedSnapshot(record?.homeFeed, url);
  } catch {
    return null;
  }
}

export function journeyToken(): string | null {
  const url = new URL(window.location.href);
  const legacyToken = url.searchParams.get("journey");
  const pending = pendingJourney?.href === url.pathname + url.hash ? pendingJourney : null;
  const token = pending ? pending.token : (window.history.state?.[HISTORY_KEY] ?? legacyToken);
  if (pending || url.searchParams.has("journey")) {
    url.searchParams.delete("journey");
    try {
      window.history.replaceState(
        {
          ...window.history.state,
          [HISTORY_KEY]: token,
          ...(pending?.context ? { [HISTORY_CONTEXT_KEY]: pending.context } : {}),
          ...(pending?.homeFeedRef ? { [HOME_HISTORY_KEY]: pending.homeFeedRef } : {}),
        },
        "",
        url.pathname + url.search + url.hash,
      );
    } catch {
      // The same-tab memory journey can still provide a return link.
    }
    if (pending) cancelPendingJourney();
  }
  return typeof token === "string" ? token : null;
}

export function saveFeedHistory(snapshot: FeedSnapshot) {
  try {
    const ref = saveFeedSnapshot(snapshot, window.history.state?.[HOME_HISTORY_KEY]);
    if (ref) window.history.replaceState({ ...window.history.state, [HOME_HISTORY_KEY]: ref }, "");
  } catch {
    /* History state is optional; ordinary pagination still works. */
  }
}

export function consumeFeedReturn(url: string): FeedSnapshot | null {
  if (pendingHomeReturn?.context.url === url) {
    const snapshot = readFeedSnapshot(pendingHomeReturn.homeFeedRef, url);
    pendingHomeReturn = null;
    if (snapshot) return snapshot;
  }
  const store = storage();
  if (store) {
    try {
      const record = JSON.parse(store.getItem(RESTORE_KEY) ?? "null");
      const context = record?.tabId === currentTabId() ? validBrowseContext(record?.context) : null;
      const snapshot =
        context?.url === url
          ? (readFeedSnapshot(record?.homeFeedRef, url) ?? validFeedSnapshot(record?.homeFeed, url))
          : null;
      if (snapshot) {
        try {
          store.removeItem(RESTORE_KEY);
        } catch {
          // Cleanup is best effort; the snapshot has already been recovered.
        }
        return snapshot;
      }
    } catch {
      /* Browser history can still reconstruct a previous list. */
    }
  }
  return (
    readFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], url) ??
    validFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], url)
  );
}

export function recordBrowseJourney(id: string, focusFeedStory: boolean) {
  let journey: string | null = null;
  const store = storage();
  const url = window.location.pathname + window.location.search;
  const label = browseLabel(url);
  const focusStoryId = focusFeedStory ? id : null;
  let homeFeedRef = label
    ? positionFeedSnapshot(
        window.history.state?.[HOME_HISTORY_KEY],
        url,
        window.scrollY,
        focusStoryId,
      )
    : null;
  if (!homeFeedRef && label) {
    const legacy = validFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], url);
    if (legacy)
      homeFeedRef = saveFeedSnapshot(
        { ...legacy, scrollY: window.scrollY, focusStoryId, savedAt: Date.now() },
        null,
      );
  }
  if (homeFeedRef) {
    try {
      window.history.replaceState({ ...window.history.state, [HOME_HISTORY_KEY]: homeFeedRef }, "");
    } catch {
      // Same-tab memory still preserves the return.
    }
  }
  const context: BrowseContext | null = label
    ? { url, label, scrollY: window.scrollY, savedAt: Date.now() }
    : null;
  if (label && typeof window.crypto?.randomUUID === "function") {
    try {
      const tabId = ensureTabId();
      const token = window.crypto.randomUUID();
      memoryJourneys.set(token, { context, homeFeedRef });
      journey = token;
      cleanupMemoryJourneys();
      if (store && tabId) {
        cleanupJourneyStorage(store);
        store.setItem(PREFIX + token, JSON.stringify({ tabId, context, homeFeedRef }));
        cleanupJourneyStorage(store);
      }
    } catch {
      /* History and same-tab memory can preserve the return without storage. */
    }
  }
  return { journey, context, homeFeedRef };
}

export function rememberJourneyReturn(context: BrowseContext | null) {
  const store = storage();
  if (!context) return;
  pendingListReturn = context;
  const token = journeyToken();
  const existingRef = readJourneyHomeFeedRef(token, context.url);
  const legacyHomeFeed = existingRef ? null : readJourneyHomeFeed(token, context.url);
  const homeFeedRef =
    existingRef ?? (legacyHomeFeed ? saveFeedSnapshot(legacyHomeFeed, null) : null);
  if (homeFeedRef) pendingHomeReturn = { context, homeFeedRef };
  if (store) {
    try {
      store.setItem(
        RESTORE_KEY,
        JSON.stringify({
          tabId: currentTabId(),
          context,
          ...(homeFeedRef ? { homeFeedRef } : {}),
        }),
      );
    } catch {
      /* The same-tab memory fallback still restores this return. */
    }
  }
}

export function restoreListPosition() {
  const store = storage();
  let record: { tabId?: string; context?: unknown } | null = null;
  if (store) {
    try {
      record = JSON.parse(store.getItem(RESTORE_KEY) ?? "null");
    } catch {
      // Continue to the same-tab memory fallback.
    }
  }
  const storedContext =
    record?.tabId === currentTabId() ? validBrowseContext(record?.context) : null;
  const context = validBrowseContext(pendingListReturn) ?? storedContext;
  if (!context || context.url !== window.location.pathname + window.location.search) return;
  const frame = requestAnimationFrame(() => {
    window.scrollTo({ top: context.scrollY, behavior: "auto" });
    pendingListReturn = null;
    try {
      store?.removeItem(RESTORE_KEY);
    } catch {
      // Stale storage cleanup must not interrupt the restored page.
    }
  });
  return () => cancelAnimationFrame(frame);
}
