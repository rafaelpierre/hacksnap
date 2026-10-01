"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { PublicFeedStory } from "../lib/stories-api";
import {
  appendUniqueStories,
  homePageURL,
  validFeedPage,
  type FeedPagination,
  type FeedSnapshot,
} from "../lib/feed-state";
import { track } from "../lib/analytics";
import {
  clearHomeFeedCheckpoint,
  readHomeFeedCheckpoint,
  saveHomeFeedCheckpoint,
  type HomeFeedCheckpoint,
} from "../lib/home-feed-checkpoint";
import { consumeFeedReturn, saveFeedHistory } from "./story-navigation";
import { WindowedStoryList } from "./windowed-story-list";
import { emptyStoryHistory, readStoryHistory, subscribeStoryHistory } from "../lib/story-history";

type FeedState = {
  stories: PublicFeedStory[];
  pagination: FeedPagination;
  phase: "idle" | "loading" | "failed" | "expired";
  announcement: string;
};

type ScrollTarget = {
  y: number;
  storyId: string | null;
  offset: number | null;
  focusStoryId: string | null;
};

const FRESH_QUERY = "__hacksnap_fresh";
const CHECKPOINT_DELAY_MS = 400;
const POSITION_SETTLE_MS = 2000;
const FRESHNESS_CHECK_MS = 60_000;

function currentURL() {
  return window.location.pathname + window.location.search;
}

function validSelectionIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 400 ||
    value.some((id) => typeof id !== "string" || !/^[1-9][0-9]{0,14}$/.test(id)) ||
    new Set(value).size !== value.length
  )
    return null;
  return value;
}

function viewportAnchor(): HomeFeedCheckpoint["anchor"] {
  const rows = document.querySelectorAll<HTMLElement>(".story-list [data-home-story-id]");
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) {
      return { storyId: row.dataset.homeStoryId!, offset: rect.top };
    }
  }
  return null;
}

export function StoryFeed({
  initialStories,
  initialPagination,
  initialSelectionIds,
  listingPath = "/",
  groupByDay = false,
  emptyState,
}: {
  initialStories: PublicFeedStory[];
  initialPagination: FeedPagination;
  initialSelectionIds?: string[];
  listingPath?: string;
  groupByDay?: boolean;
  emptyState?: ReactNode;
}) {
  const ranked = listingPath === "/";
  const pageURL = (page: number, cursor: string | null) =>
    ranked ? homePageURL(page, cursor) : page === 1 ? listingPath : `${listingPath}?page=${page}`;
  const [feed, setFeed] = useState<FeedState>({
    stories: initialStories,
    pagination: initialPagination,
    phase: "idle",
    announcement: "",
  });
  const [startingPage, setStartingPage] = useState(initialPagination.page);
  const hasNewerPage = startingPage > 1 && (!ranked || !!initialPagination.previousCursor);
  const hasOlderPage = !ranked && feed.pagination.hasMore;
  const [restored, setRestored] = useState(false);
  const [history, setHistory] = useState(emptyStoryHistory);
  const [restoredFromSnapshot, setRestoredFromSnapshot] = useState(false);
  const [positionPending, setPositionPending] = useState(false);
  const feedRef = useRef(feed);
  const initialized = useRef(false);
  const canPersist = useRef(false);
  const suppressPersistence = useRef(false);
  const positionSettled = useRef(true);
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const scrollTarget = useRef<ScrollTarget | null>(null);
  const [pinnedStoryId, setPinnedStoryId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [continuationFocused, setContinuationFocused] = useState(false);
  const [automaticLoadingAvailable, setAutomaticLoadingAvailable] = useState(true);
  const baselineIds = useRef<ReadonlySet<string> | null>(
    initialSelectionIds ? new Set(initialSelectionIds) : null,
  );
  const [newStoriesAvailable, setNewStoriesAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [freshFocusId, setFreshFocusId] = useState<string | null | undefined>(undefined);
  const refreshRequest = useRef<AbortController | null>(null);
  const freshSelectionGeneration = useRef(0);
  const activeTrigger = useRef<"auto" | "manual" | null>(null);
  feedRef.current = feed;
  const openedIds = useMemo(
    () => new Set(Object.keys(history.entries).filter((id) => !!history.entries[id]?.openedAt)),
    [history],
  );

  useEffect(() => {
    setHistory(readStoryHistory());
    return subscribeStoryHistory(() => setHistory(readStoryHistory()));
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") setAutomaticLoadingAvailable(false);
  }, []);

  useEffect(() => {
    return () => {
      refreshRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!ranked || !restored || positionPending || !baselineIds.current) return;
    let checking = false;
    let lastCheck = 0;
    let active = true;
    let cancelPending: (() => void) | null = null;
    const check = async () => {
      if (document.visibilityState !== "visible" || checking) return;
      if (Date.now() - lastCheck < FRESHNESS_CHECK_MS) return;
      lastCheck = Date.now();
      checking = true;
      const generation = freshSelectionGeneration.current;
      const request = new AbortController();
      let timeout: number | null = null;
      try {
        const result: unknown = await Promise.race([
          (async () => {
            const response = await fetch("/api/story-freshness", {
              signal: request.signal,
              cache: "no-store",
            });
            return response.ok ? response.json() : null;
          })(),
          new Promise<null>((resolve) => {
            cancelPending = () => {
              request.abort();
              resolve(null);
            };
            timeout = window.setTimeout(cancelPending, 15_000);
          }),
        ]);
        if (
          !active ||
          generation !== freshSelectionGeneration.current ||
          !result ||
          typeof result !== "object"
        )
          return;
        const currentIds = validSelectionIds((result as { ids?: unknown }).ids);
        if (!currentIds) return;
        if (currentIds.some((id) => !baselineIds.current?.has(id))) setNewStoriesAvailable(true);
      } catch {
        // Keep the current selection and retry after the bounded interval.
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
        cancelPending = null;
        checking = false;
        if (active && lastCheck === 0 && document.visibilityState === "visible") void check();
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), FRESHNESS_CHECK_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelPending?.();
        lastCheck = 0;
      } else void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      cancelPending?.();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ranked, restored, positionPending]);

  function snapshotNow(): FeedSnapshot {
    const current = feedRef.current;
    return {
      version: 1,
      url: currentURL(),
      stories: current.stories,
      pagination: current.pagination,
      scrollY: window.scrollY,
      focusStoryId: null,
      savedAt: Date.now(),
    };
  }

  function persistNow() {
    if (
      !canPersist.current ||
      suppressPersistence.current ||
      !positionSettled.current ||
      currentURL() !== "/" ||
      feedRef.current.phase === "expired"
    )
      return;
    saveHomeFeedCheckpoint({ version: 1, snapshot: snapshotNow(), anchor: viewportAnchor() });
  }

  function cancelCheckpointTimer() {
    if (checkpointTimer.current !== null) clearTimeout(checkpointTimer.current);
    checkpointTimer.current = null;
  }

  function scheduleCheckpoint() {
    if (!canPersist.current || suppressPersistence.current) return;
    cancelCheckpointTimer();
    checkpointTimer.current = setTimeout(() => {
      checkpointTimer.current = null;
      persistNow();
    }, CHECKPOINT_DELAY_MS);
  }

  useEffect(() => {
    const applySnapshot = (snapshot: FeedSnapshot, anchor: HomeFeedCheckpoint["anchor"]) => {
      setRestoredFromSnapshot(true);
      const page = Number(
        new URL(snapshot.url, window.location.origin).searchParams.get("page") ?? "1",
      );
      setStartingPage(Number.isSafeInteger(page) && page > 0 ? page : 1);
      scrollTarget.current = {
        y: snapshot.scrollY,
        storyId: anchor?.storyId ?? null,
        offset: anchor?.offset ?? null,
        focusStoryId: snapshot.focusStoryId,
      };
      setPinnedStoryId(anchor?.storyId ?? snapshot.focusStoryId);
      positionSettled.current = false;
      setPositionPending(true);
      const next = {
        stories: snapshot.stories,
        pagination: snapshot.pagination,
        phase: "idle" as const,
        announcement: "",
      };
      feedRef.current = next;
      setFeed(next);
    };
    if (!initialized.current) {
      initialized.current = true;
      const url = currentURL();
      const freshURL = new URL(window.location.href);
      const freshRequested =
        freshURL.pathname === "/" && freshURL.searchParams.get(FRESH_QUERY) === "1";
      if (freshRequested) {
        freshURL.searchParams.delete(FRESH_QUERY);
        const state = { ...window.history.state };
        delete state.hacksnapHomeFeed;
        window.history.replaceState(state, "", freshURL.pathname + freshURL.search);
        clearHomeFeedCheckpoint();
        canPersist.current = true;
      } else {
        const historyReturn = consumeFeedReturn(url);
        if (historyReturn) {
          applySnapshot(historyReturn, null);
          canPersist.current = true;
        } else if (url === "/") {
          const result = readHomeFeedCheckpoint(url);
          if (result?.status === "recent") {
            applySnapshot(result.checkpoint.snapshot, result.checkpoint.anchor);
            canPersist.current = true;
          } else if (result) {
            clearHomeFeedCheckpoint();
            canPersist.current = true;
          } else {
            canPersist.current = true;
          }
        } else {
          canPersist.current = true;
        }
      }
      setRestored(true);
    }
    const onPopState = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      requestId.current++;
      const restoredPage = consumeFeedReturn(window.location.pathname + window.location.search);
      if (!restoredPage) return;
      canPersist.current = true;
      applySnapshot(restoredPage, null);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      activeRequest.current?.abort();
      requestId.current++;
    };
  }, []);

  useLayoutEffect(() => {
    if (!restored || !scrollTarget.current) return;
    const target = scrollTarget.current;
    let frame = 0;
    let active = true;
    let focused = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const releaseTarget = () => {
      if (scrollTarget.current !== target) return;
      scrollTarget.current = null;
      setPinnedStoryId(null);
    };
    const position = () => {
      frame = 0;
      if (!active || scrollTarget.current !== target) return;
      const row = target.storyId
        ? document.querySelector<HTMLElement>(`[data-home-story-id="${target.storyId}"]`)
        : null;
      const top =
        row && target.offset !== null
          ? window.scrollY + row.getBoundingClientRect().top - target.offset
          : target.y;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      if (!focused && target.focusStoryId) {
        const link = document.querySelector<HTMLAnchorElement>(
          `[data-home-story-id="${target.focusStoryId}"] h3 a`,
        );
        if (link) {
          link.focus({ preventScroll: true });
          focused = true;
        }
      }
      // Background tabs may run timers while suspending animation frames.
      // Keep the target and checkpoint protected until positioning has run.
      if (settleTimer === null) {
        settleTimer = setTimeout(() => {
          active = false;
          releaseTarget();
          positionSettled.current = true;
          setPositionPending(false);
        }, POSITION_SETTLE_MS);
      }
      positionSettled.current = true;
      setPositionPending(false);
    };
    const schedulePosition = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const stop = () => {
      releaseTarget();
      active = false;
      if (settleTimer !== null) clearTimeout(settleTimer);
      positionSettled.current = true;
      setPositionPending(false);
    };
    schedulePosition();
    const list = document.querySelector<HTMLElement>(".story-list");
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedulePosition) : null;
    if (list) observer?.observe(list);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("pointerdown", stop, { passive: true });
    window.addEventListener("keydown", stop);
    void document.fonts?.ready.then(() => {
      if (active) schedulePosition();
    });
    return () => {
      active = false;
      if (settleTimer !== null) clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [feed.stories, restored]);

  useEffect(() => {
    if (!restored) return;
    saveFeedHistory(snapshotNow());
    if (!positionPending) persistNow();
  }, [feed.stories, feed.pagination, positionPending, restored]);

  useEffect(() => {
    if (!restored) return;
    const onScroll = () => {
      scheduleCheckpoint();
    };
    const flush = () => {
      cancelCheckpointTimer();
      persistNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelCheckpointTimer();
    };
  }, [restored]);

  useEffect(() => {
    if (!ranked || !restored || feed.pagination.hasMore) return;
    track(
      "home_feed_end",
      {
        outcome: feed.pagination.selectionLimited ? "selection_limited" : "exhausted",
        position: feed.stories.length,
        placement: "home_feed",
      },
      `home-end:${feed.pagination.page}`,
    );
  }, [feed.pagination, feed.stories.length, restored, ranked]);

  const load = useCallback(
    async (trigger: "auto" | "manual") => {
      const trackLoad = (params: Parameters<typeof track>[1]) => {
        if (ranked) track("home_feed_load", params);
      };
      const current = feedRef.current;
      if (
        activeRequest.current ||
        refreshRequest.current ||
        !positionSettled.current ||
        current.phase === "expired" ||
        !current.pagination.hasMore ||
        (ranked && !current.pagination.cursor)
      )
        return;
      const controller = new AbortController();
      const id = ++requestId.current;
      activeRequest.current = controller;
      activeTrigger.current = trigger;
      setFeed((state) => ({ ...state, phase: "loading", announcement: "" }));
      const onAbort = () =>
        trackLoad({ outcome: "cancelled", trigger, position: current.stories.length });
      controller.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const query = ranked
          ? new URLSearchParams({ cursor: current.pagination.cursor! })
          : new URLSearchParams({ path: listingPath, page: String(current.pagination.page + 1) });
        const response = await fetch(`/api/${ranked ? "ready" : "browse"}-stories?${query}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (id !== requestId.current || controller.signal.aborted) return;
        if (response.status === 410) {
          if (currentURL() === "/") clearHomeFeedCheckpoint();
          setFeed((state) => ({ ...state, phase: "expired" }));
          trackLoad({ outcome: "expired", trigger, position: current.stories.length });
          return;
        }
        if (!response.ok) throw new Error("Story load failed");
        const page = validFeedPage(await response.json(), listingPath);
        if (!page || page.pagination.page !== current.pagination.page + 1)
          throw new Error("Invalid story page");
        if (id !== requestId.current || controller.signal.aborted) return;
        const stories = appendUniqueStories(current.stories, page.stories);
        // Live offsets can repeat a whole batch after new arrivals; keep their page advance.
        if (ranked && stories.length === current.stories.length && page.pagination.hasMore)
          throw new Error("Story page made no progress");
        const added = stories.length - current.stories.length;
        const next = {
          stories,
          pagination: page.pagination,
          phase: "idle" as const,
          announcement: added
            ? `${added} more ${added === 1 ? "story" : "stories"} loaded. ${stories.length} total.`
            : "No new stories in this batch.",
        };
        feedRef.current = next;
        setFeed(next);
        trackLoad({
          outcome: page.stories.length ? "success" : "empty",
          trigger,
          position: stories.length,
        });
      } catch {
        if (id === requestId.current && !controller.signal.aborted) {
          setFeed((state) => ({ ...state, phase: "failed" }));
          trackLoad({ outcome: "failure", trigger, position: current.stories.length });
        }
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
        if (id === requestId.current) activeRequest.current = null;
      }
    },
    [listingPath, ranked],
  );

  async function refreshSelection() {
    if (refreshing || refreshRequest.current || !ranked) return;
    const previousPhase = feedRef.current.phase;
    freshSelectionGeneration.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestId.current++;
    const controller = new AbortController();
    refreshRequest.current = controller;
    setRefreshing(true);
    setRefreshFailed(false);
    setFeed((state) => ({ ...state, phase: "idle" }));
    try {
      const response = await fetch("/api/ready-stories?fresh=1", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Fresh selection unavailable");
      const raw: unknown = await response.json();
      const page = validFeedPage(raw, "/");
      if (!page || page.pagination.page !== 1) throw new Error("Invalid fresh selection");
      if (controller.signal.aborted) return;
      const ids =
        raw && typeof raw === "object" && "selectionIds" in raw
          ? validSelectionIds(raw.selectionIds)
          : null;
      if (!ids) throw new Error("Invalid fresh selection membership");
      clearHomeFeedCheckpoint();
      if (currentURL() !== "/") {
        const state = { ...window.history.state };
        delete state.hacksnapHomeFeed;
        window.history.replaceState(state, "", "/");
      }
      const next: FeedState = {
        stories: page.stories,
        pagination: page.pagination,
        phase: "idle",
        announcement: "Fresh story selection loaded.",
      };
      feedRef.current = next;
      setFeed(next);
      setStartingPage(1);
      baselineIds.current = new Set(ids);
      setNewStoriesAvailable(false);
      setPinnedStoryId(page.stories[0]?.hn_id ?? null);
      setFreshFocusId(page.stories[0]?.hn_id ?? null);
    } catch {
      if (!controller.signal.aborted) {
        setFeed((state) => ({
          ...state,
          phase: previousPhase === "expired" || previousPhase === "failed" ? previousPhase : "idle",
        }));
        setRefreshFailed(true);
      }
    } finally {
      if (refreshRequest.current === controller) refreshRequest.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }

  useLayoutEffect(() => {
    if (freshFocusId === undefined) return;
    window.scrollTo({ top: 0, behavior: "instant" });
    const target = freshFocusId
      ? document.querySelector<HTMLAnchorElement>(`[data-home-story-id="${freshFocusId}"] h3 a`)
      : document.querySelector<HTMLElement>(".home-intro h1");
    if (target) {
      if (!freshFocusId) target.tabIndex = -1;
      // A large text setting can put the first card below the fold; keep focus visible.
      target.focus();
    }
    setFreshFocusId(undefined);
    setPinnedStoryId(null);
  }, [freshFocusId, feed.stories]);

  function startLatest(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    suppressPersistence.current = true;
    cancelCheckpointTimer();
    clearHomeFeedCheckpoint();
  }

  useEffect(() => {
    if (
      !restored ||
      positionPending ||
      refreshing ||
      !feed.pagination.hasMore ||
      feed.phase !== "idle" ||
      continuationFocused ||
      !sentinel.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!positionSettled.current) return;
        void load("auto");
        observer.disconnect();
      },
      { rootMargin: "0px 0px 500px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [
    continuationFocused,
    feed.pagination.hasMore,
    feed.pagination.page,
    feed.phase,
    load,
    positionPending,
    refreshing,
    restored,
  ]);

  return (
    <>
      {ranked && (newStoriesAvailable || refreshFailed) && (
        <div className="feed-freshness-banner">
          <span className="sr-only" role="status" aria-live="polite">
            {refreshFailed ? "Couldn’t refresh stories. Try again." : "New stories available."}
          </span>
          <button
            type="button"
            disabled={refreshing}
            aria-label={refreshFailed ? "Retry loading new stories" : undefined}
            onClick={() => void refreshSelection()}
          >
            {refreshing ? "Refreshing…" : refreshFailed ? "Try again" : "Show new stories"}
          </button>
        </div>
      )}
      {feed.stories.length === 0 ? (
        (emptyState ?? (
          <div className="empty">
            <h2>No stories yet.</h2>
            <p>Stories will appear after the next update.</p>
          </div>
        ))
      ) : (
        <WindowedStoryList
          stories={feed.stories}
          ranked={ranked}
          openedIds={openedIds}
          initialPage={startingPage}
          groupByDay={groupByDay}
          pinnedStoryId={pinnedStoryId}
          leadImagePriority={restored && !restoredFromSnapshot && !positionPending}
          onStoryTitleClickCapture={
            ranked
              ? (event) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    !(event.target as Element).closest("[data-home-story-id] h3 a")
                  )
                    return;
                  cancelCheckpointTimer();
                  persistNow();
                }
              : undefined
          }
        />
      )}
      <div ref={sentinel} className="home-feed-sentinel" aria-hidden="true" />
      <div
        className="home-feed-continuation"
        onFocusCapture={() => {
          setContinuationFocused(true);
          if (activeRequest.current && activeTrigger.current === "auto") {
            activeRequest.current.abort();
            activeRequest.current = null;
            requestId.current++;
            setFeed((state) => ({ ...state, phase: "idle" }));
          }
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setContinuationFocused(false);
        }}
      >
        <p role="status" aria-live="polite" className="home-feed-status">
          {feed.phase === "loading" && <span className="home-feed-spinner" aria-hidden="true" />}
          {feed.phase === "loading" && "Loading more stories…"}
          {feed.phase === "failed" && "Couldn’t load more stories. Your place is saved; try again."}
          {feed.phase === "expired" &&
            "This story selection is no longer available. Your loaded stories are still here."}
          {feed.phase === "idle" &&
            `${feed.announcement}${feed.announcement && !feed.pagination.hasMore ? " " : ""}${
              !feed.pagination.hasMore
                ? feed.pagination.selectionLimited
                  ? "That’s the end of this selection. More stories are available in the archive."
                  : feed.stories.length > 0
                    ? "You’ve reached the end of these stories."
                    : ""
                : ""
            }`}
        </p>
        {restored &&
          !positionPending &&
          feed.pagination.hasMore &&
          feed.phase !== "expired" &&
          (feed.phase === "failed" || !automaticLoadingAvailable) && (
            <div className="home-feed-actions">
              <button
                className="button"
                type="button"
                disabled={feed.phase === "loading"}
                onClick={() => {
                  setContinuationFocused(false);
                  void load("manual");
                }}
              >
                {feed.phase === "failed" ? "Try loading again" : "Load more stories"}
              </button>
            </div>
          )}
        {feed.phase === "expired" && (
          <a
            className="button"
            href={ranked ? `/?${FRESH_QUERY}=1` : listingPath}
            onClick={ranked ? startLatest : undefined}
          >
            Start a fresh selection
          </a>
        )}
        {(hasNewerPage || hasOlderPage) && (
          <nav className="home-feed-pages" aria-label="Story pages">
            {hasNewerPage && (
              <Link
                href={pageURL(startingPage - 1, initialPagination.previousCursor)}
                prefetch={false}
              >
                Newer stories
              </Link>
            )}
            {hasOlderPage && (
              <Link href={pageURL(feed.pagination.page + 1, null)} prefetch={false}>
                Older stories
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
