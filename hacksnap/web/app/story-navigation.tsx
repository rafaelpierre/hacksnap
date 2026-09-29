"use client";

import { ChevronLeft } from "lucide-react";
import { track } from "../lib/analytics";
import Link from "next/link";
import { storyPath } from "../lib/story-url";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { browseLabel, validBrowseContext, type BrowseContext } from "../lib/navigation-context";
import { validHomeFeedSnapshot, type HomeFeedSnapshot } from "../lib/home-feed-state";

const PREFIX = "hacksnap:journey:";
const RESTORE_KEY = "hacksnap:pending-return";
const TAB_PREFIX = "hacksnap-tab:";
const HISTORY_KEY = "hacksnapJourney";
const HISTORY_CONTEXT_KEY = "hacksnapBrowseContext";
const HOME_HISTORY_KEY = "hacksnapHomeFeed";
// router.push has no state argument. Hand off the token in memory until the
// destination commits, then attach it to that entry without changing its URL.
let pendingJourney: {
  href: string;
  token: string | null;
  context: BrowseContext | null;
  homeFeed: HomeFeedSnapshot | null;
} | null = null;
let pendingHomeReturn: { context: BrowseContext; homeFeed: HomeFeedSnapshot } | null = null;
let initialHomeRestoreChecked = false;

function cancelPendingJourney() {
  pendingJourney = null;
  window.removeEventListener("popstate", cancelPendingJourney);
}

function prepareJourney(
  href: string,
  token: string | null,
  context: BrowseContext | null = null,
  homeFeed: HomeFeedSnapshot | null = null,
) {
  pendingJourney = { href, token, context, homeFeed };
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
  return window.name.startsWith(TAB_PREFIX) ? window.name : null;
}

function readJourney(token: string | null): BrowseContext | null {
  const fromHistory = validBrowseContext(window.history.state?.[HISTORY_CONTEXT_KEY]);
  if (fromHistory && window.history.state?.[HISTORY_KEY] === token) return fromHistory;
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) return null;
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

function journeyToken(): string | null {
  const url = new URL(window.location.href);
  const legacyToken = url.searchParams.get("journey");
  const pending = pendingJourney?.href === url.pathname + url.hash ? pendingJourney : null;
  const token = pending ? pending.token : (window.history.state?.[HISTORY_KEY] ?? legacyToken);
  if (pending || url.searchParams.has("journey")) {
    url.searchParams.delete("journey");
    window.history.replaceState(
      {
        ...window.history.state,
        [HISTORY_KEY]: token,
        ...(pending?.context ? { [HISTORY_CONTEXT_KEY]: pending.context } : {}),
        ...(pending?.homeFeed ? { [HOME_HISTORY_KEY]: pending.homeFeed } : {}),
      },
      "",
      url.pathname + url.search + url.hash,
    );
    if (pending) cancelPendingJourney();
  }
  return typeof token === "string" ? token : null;
}

export function saveHomeFeedHistory(snapshot: HomeFeedSnapshot) {
  try {
    window.history.replaceState({ ...window.history.state, [HOME_HISTORY_KEY]: snapshot }, "");
  } catch {
    /* History state is optional; ordinary pagination still works. */
  }
}

export function consumeHomeFeedReturn(url: string): HomeFeedSnapshot | null {
  const initialCheck = !initialHomeRestoreChecked;
  initialHomeRestoreChecked = true;
  const navigation = window.performance?.getEntriesByType?.("navigation")?.[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (initialCheck && navigation?.type === "reload") {
    let reloadedHome = false;
    try {
      const documentURL = new URL(navigation.name);
      reloadedHome =
        documentURL.origin === window.location.origin &&
        documentURL.pathname + documentURL.search === url;
    } catch {
      /* An unavailable timing entry does not override a saved return. */
    }
    if (reloadedHome) {
      const state = { ...window.history.state };
      delete state[HOME_HISTORY_KEY];
      window.history.replaceState(state, "");
      pendingHomeReturn = null;
      try {
        storage()?.removeItem(RESTORE_KEY);
      } catch {
        /* Storage is optional. */
      }
      return null;
    }
  }
  if (pendingHomeReturn?.context.url === url) {
    const snapshot = validHomeFeedSnapshot(pendingHomeReturn.homeFeed, url);
    pendingHomeReturn = null;
    if (snapshot) return snapshot;
  }
  const store = storage();
  if (store) {
    try {
      const record = JSON.parse(store.getItem(RESTORE_KEY) ?? "null");
      const context = record?.tabId === currentTabId() ? validBrowseContext(record?.context) : null;
      const snapshot = context?.url === url ? validHomeFeedSnapshot(record?.homeFeed, url) : null;
      if (snapshot) {
        store.removeItem(RESTORE_KEY);
        return snapshot;
      }
    } catch {
      /* Browser history can still reconstruct a previous list. */
    }
  }
  return validHomeFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], url);
}

function plainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

export function BrowseStoryLink({
  id,
  slug,
  anchor,
  feedPosition,
  children,
}: {
  id: string;
  slug?: string | null;
  anchor?: "discussion-analysis";
  feedPosition?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `${storyPath(id, slug)}${anchor ? `#${anchor}` : ""}`;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && feedPosition && feedPosition > 10) {
      track("home_story_open", { story_id: id, position: feedPosition, placement: "home_feed" });
    }
    if (!plainClick(event)) return;
    let journey: string | null = null;
    const store = storage();
    const url = window.location.pathname + window.location.search;
    const label = browseLabel(url);
    const savedHomeFeed = label?.startsWith("Top stories")
      ? validHomeFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], url)
      : null;
    const homeFeed = savedHomeFeed
      ? { ...savedHomeFeed, scrollY: window.scrollY, focusStoryId: id, savedAt: Date.now() }
      : null;
    if (homeFeed) saveHomeFeedHistory(homeFeed);
    const context: BrowseContext | null = label
      ? { url, label, scrollY: window.scrollY, savedAt: Date.now() }
      : null;
    if (store && label && typeof window.crypto?.randomUUID === "function") {
      try {
        if (!currentTabId()) window.name = TAB_PREFIX + crypto.randomUUID();
        const token = crypto.randomUUID();
        store.setItem(PREFIX + token, JSON.stringify({ tabId: currentTabId(), context, homeFeed }));
        journey = token;
      } catch {
        /* Use the canonical destination when storage is unavailable. */
      }
    }
    event.preventDefault();
    prepareJourney(href, journey, context, homeFeed);
    startTransition(() => router.push(href));
  }
  return (
    <>
      <Link
        href={href}
        onClick={open}
        onAuxClick={(event) => {
          if (event.button === 1 && feedPosition && feedPosition > 10)
            track("home_story_open", {
              story_id: id,
              position: feedPosition,
              placement: "home_feed",
            });
        }}
        aria-busy={pending || undefined}
      >
        {children}
      </Link>
      {pending && (
        <span className="navigation-pending" role="status">
          Opening story…
        </span>
      )}
    </>
  );
}

export function NextStoryLink({
  id,
  slug,
  children,
}: {
  id: string;
  slug?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = storyPath(id, slug);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!plainClick(event)) return;
    const token = journeyToken();
    const journey = readJourney(token) ? token : null;
    event.preventDefault();
    const context = readJourney(journey);
    const homeFeed = context
      ? validHomeFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], context.url)
      : null;
    prepareJourney(href, journey, context, homeFeed);
    startTransition(() => router.push(href));
  }
  return (
    <>
      <Link href={href} onClick={open} aria-busy={pending || undefined}>
        {children}
      </Link>
      {pending && (
        <span className="navigation-pending" role="status">
          Opening story…
        </span>
      )}
    </>
  );
}

export function StoryReturnLink({
  destination,
  archiveOnly = false,
}: { destination?: { href: string; label: string }; archiveOnly?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [context, setContext] = useState<BrowseContext | null>(null);
  useEffect(() => {
    function updateContext(event?: PopStateEvent) {
      if (event) cancelPendingJourney();
      const saved = readJourney(journeyToken());
      const path = saved?.url.split("?")[0];
      const matches = archiveOnly
        ? path === "/archive" || path?.startsWith("/archive/")
        : !destination || path === destination.href;
      setContext(saved && matches ? saved : null);
    }
    updateContext();
    window.addEventListener("popstate", updateContext);
    return () => window.removeEventListener("popstate", updateContext);
  }, [pathname, destination?.href, archiveOnly]);
  function rememberReturn(event: MouseEvent<HTMLAnchorElement>) {
    track("story_return");
    if (!plainClick(event)) return;
    if (context && !validBrowseContext(context)) {
      event.preventDefault();
      setContext(null);
      router.push(destination?.href ?? "/");
      return;
    }
    const store = storage();
    if (!context) return;
    const homeFeed = validHomeFeedSnapshot(window.history.state?.[HOME_HISTORY_KEY], context.url);
    if (homeFeed) pendingHomeReturn = { context, homeFeed };
    if (!store) return;
    try {
      store.setItem(
        RESTORE_KEY,
        JSON.stringify({ tabId: currentTabId(), context, ...(homeFeed ? { homeFeed } : {}) }),
      );
    } catch {
      /* The link still returns to the list. */
    }
  }
  if (archiveOnly && !context) return null;
  return (
    <Link
      className={destination ? "breadcrumb-link" : "back-link"}
      href={context?.url ?? destination?.href ?? "/"}
      scroll={!context}
      onClick={rememberReturn}
    >
      {!destination && <ChevronLeft className="inline-icon" aria-hidden="true" />}{" "}
      {archiveOnly && "Back to "}
      {destination?.label ?? context?.label ?? "Top stories"}
    </Link>
  );
}

export function ListPositionRestorer() {
  useEffect(() => {
    const store = storage();
    if (!store) return;
    let record: { tabId?: string; context?: unknown } | null = null;
    try {
      record = JSON.parse(store.getItem(RESTORE_KEY) ?? "null");
    } catch {
      return;
    }
    const context = record?.tabId === currentTabId() ? validBrowseContext(record?.context) : null;
    if (!context || context.url !== window.location.pathname + window.location.search) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: context.scrollY, behavior: "auto" });
      store.removeItem(RESTORE_KEY);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
