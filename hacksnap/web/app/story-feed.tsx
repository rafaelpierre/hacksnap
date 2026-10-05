"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PublicFeedStory } from "../lib/stories-api";
import {
  appendUniqueStories,
  validFeedPage,
  type FeedPagination,
  type FeedSnapshot,
} from "../lib/feed-state";
import { clearHomeFeedCheckpoint } from "../lib/home-feed-checkpoint";
import { consumeFeedReturn, saveFeedHistory } from "./story-navigation";
import { WindowedStoryList } from "./windowed-story-list";
import { emptyStoryHistory, readStoryHistory, subscribeStoryHistory } from "../lib/story-history";

type FeedState = {
  stories: PublicFeedStory[];
  pagination: FeedPagination;
  phase: "idle" | "loading" | "failed";
  announcement: string;
};

type ScrollTarget = {
  y: number;
  storyId: string | null;
  offset: number | null;
  focusStoryId: string | null;
};

const HISTORY_SAVE_DELAY_MS = 400;
const POSITION_SETTLE_MS = 2000;

function currentURL() {
  return window.location.pathname + window.location.search;
}

export function StoryFeed({
  initialStories,
  initialPagination,
  listingPath = "/",
  groupByDay = false,
  emptyState,
}: {
  initialStories: PublicFeedStory[];
  initialPagination: FeedPagination;
  listingPath?: string;
  groupByDay?: boolean;
  emptyState?: ReactNode;
}) {
  const latest = listingPath === "/";
  const pageURL = (page: number) => (page === 1 ? listingPath : `${listingPath}?page=${page}`);
  const [feed, setFeed] = useState<FeedState>({
    stories: initialStories,
    pagination: initialPagination,
    phase: "idle",
    announcement: "",
  });
  const [startingPage, setStartingPage] = useState(initialPagination.page);
  const hasNewerPage = startingPage > 1;
  const hasOlderPage = feed.pagination.hasMore;
  const [restored, setRestored] = useState(false);
  const [history, setHistory] = useState(emptyStoryHistory);
  const [restoredFromSnapshot, setRestoredFromSnapshot] = useState(false);
  const [positionPending, setPositionPending] = useState(false);
  const feedRef = useRef(feed);
  const initialized = useRef(false);
  const canPersist = useRef(false);
  const positionSettled = useRef(true);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const scrollTarget = useRef<ScrollTarget | null>(null);
  const [pinnedStoryId, setPinnedStoryId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [continuationFocused, setContinuationFocused] = useState(false);
  const [automaticLoadingAvailable, setAutomaticLoadingAvailable] = useState(true);
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
    if (!canPersist.current || !positionSettled.current || !restored) return;
    saveFeedHistory(snapshotNow());
  }

  function cancelHistoryTimer() {
    if (historyTimer.current !== null) clearTimeout(historyTimer.current);
    historyTimer.current = null;
  }

  function scheduleHistorySave() {
    if (!canPersist.current) return;
    cancelHistoryTimer();
    historyTimer.current = setTimeout(() => {
      historyTimer.current = null;
      persistNow();
    }, HISTORY_SAVE_DELAY_MS);
  }

  useEffect(() => {
    const applySnapshot = (snapshot: FeedSnapshot) => {
      setRestoredFromSnapshot(true);
      const page = Number(
        new URL(snapshot.url, window.location.origin).searchParams.get("page") ?? "1",
      );
      setStartingPage(Number.isSafeInteger(page) && page > 0 ? page : 1);
      scrollTarget.current = {
        y: snapshot.scrollY,
        storyId: null,
        offset: null,
        focusStoryId: snapshot.focusStoryId,
      };
      setPinnedStoryId(snapshot.focusStoryId);
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
      if (latest) clearHomeFeedCheckpoint();
      const historyReturn = consumeFeedReturn(url);
      if (historyReturn) applySnapshot(historyReturn);
      canPersist.current = true;
      setRestored(true);
    }
    const onPopState = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      requestId.current++;
      const restoredPage = consumeFeedReturn(window.location.pathname + window.location.search);
      if (!restoredPage) return;
      canPersist.current = true;
      applySnapshot(restoredPage);
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
      // Keep the target and saved position protected until positioning has run.
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
    if (!positionPending) persistNow();
  }, [feed.stories, feed.pagination, positionPending, restored]);

  useEffect(() => {
    if (!restored) return;
    const onScroll = () => {
      scheduleHistorySave();
    };
    const flush = () => {
      cancelHistoryTimer();
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
      cancelHistoryTimer();
    };
  }, [restored]);

  const load = useCallback(
    async (trigger: "auto" | "manual") => {
      const current = feedRef.current;
      if (activeRequest.current || !positionSettled.current || !current.pagination.hasMore) return;
      const controller = new AbortController();
      const id = ++requestId.current;
      activeRequest.current = controller;
      activeTrigger.current = trigger;
      setFeed((state) => ({ ...state, phase: "loading", announcement: "" }));
      try {
        const query = new URLSearchParams({
          path: listingPath,
          page: String(current.pagination.page + 1),
        });
        const response = await fetch(`/api/browse-stories?${query}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (id !== requestId.current || controller.signal.aborted) return;
        if (!response.ok) throw new Error("Story load failed");
        const page = validFeedPage(await response.json(), listingPath);
        if (!page || page.pagination.page !== current.pagination.page + 1)
          throw new Error("Invalid story page");
        if (id !== requestId.current || controller.signal.aborted) return;
        const stories = appendUniqueStories(current.stories, page.stories);
        // Live offsets can repeat a whole batch after new arrivals; keep their page advance.
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
      } catch {
        if (id === requestId.current && !controller.signal.aborted) {
          setFeed((state) => ({ ...state, phase: "failed" }));
        }
      } finally {
        if (id === requestId.current) activeRequest.current = null;
      }
    },
    [listingPath],
  );

  useEffect(() => {
    if (
      !restored ||
      positionPending ||
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
    restored,
  ]);

  return (
    <>
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
          ranked={false}
          openedIds={openedIds}
          initialPage={startingPage}
          groupByDay={groupByDay}
          pinnedStoryId={pinnedStoryId}
          // The first image must be eager in server HTML, before restoration runs.
          leadImagePriority={!restored || (!restoredFromSnapshot && !positionPending)}
          onStoryTitleClickCapture={() => {
            cancelHistoryTimer();
            persistNow();
          }}
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
          {feed.phase === "idle" &&
            `${feed.announcement}${feed.announcement && !feed.pagination.hasMore ? " " : ""}${
              !feed.pagination.hasMore
                ? feed.pagination.selectionLimited
                  ? "That’s the end of this selection. More stories are available by month."
                  : feed.stories.length > 0
                    ? "You’ve reached the end of these stories."
                    : ""
                : ""
            }`}
        </p>
        {restored &&
          !positionPending &&
          feed.pagination.hasMore &&
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
        {(hasNewerPage || hasOlderPage) && (
          <nav className="home-feed-pages" aria-label="Story pages">
            {hasNewerPage && (
              <Link href={pageURL(startingPage - 1)} prefetch={false}>
                Newer stories
              </Link>
            )}
            {hasOlderPage && (
              <Link href={pageURL(feed.pagination.page + 1)} prefetch={false}>
                Older stories
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
