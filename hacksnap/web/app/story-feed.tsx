"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { StoryRow } from "./story-row";
import { consumeFeedReturn, saveFeedHistory } from "./story-navigation";

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

function currentURL() {
  return window.location.pathname + window.location.search;
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
  const ranked = listingPath === "/";
  const pageURL = (page: number, cursor: string | null) =>
    ranked ? homePageURL(page, cursor) : page === 1 ? listingPath : `${listingPath}?page=${page}`;
  const [feed, setFeed] = useState<FeedState>({
    stories: initialStories,
    pagination: initialPagination,
    phase: "idle",
    announcement: "",
  });
  const [restored, setRestored] = useState(false);
  const [positionPending, setPositionPending] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<"none" | "older" | "expired">("none");
  const feedRef = useRef(feed);
  const initialized = useRef(false);
  const pendingOlder = useRef<HomeFeedCheckpoint | null>(null);
  const canPersist = useRef(false);
  const suppressPersistence = useRef(false);
  const positionSettled = useRef(true);
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const scrollTarget = useRef<ScrollTarget | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [continuationFocused, setContinuationFocused] = useState(false);
  const activeTrigger = useRef<"auto" | "manual" | null>(null);
  feedRef.current = feed;

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

  function useFreshFeed() {
    pendingOlder.current = null;
    canPersist.current = true;
    setResumeNotice("none");
    saveFeedHistory(snapshotNow());
    persistNow();
  }

  useEffect(() => {
    const applySnapshot = (snapshot: FeedSnapshot, anchor: HomeFeedCheckpoint["anchor"]) => {
      scrollTarget.current = {
        y: snapshot.scrollY,
        storyId: anchor?.storyId ?? null,
        offset: anchor?.offset ?? null,
        focusStoryId: snapshot.focusStoryId,
      };
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
          } else if (result?.status === "older") {
            pendingOlder.current = result.checkpoint;
            setResumeNotice("older");
          } else if (result?.status === "expired") {
            clearHomeFeedCheckpoint();
            setResumeNotice("expired");
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
      pendingOlder.current = null;
      canPersist.current = true;
      setResumeNotice("none");
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
        link?.focus({ preventScroll: true });
        focused = true;
      }
      // Background tabs may run timers while suspending animation frames.
      // Keep the target and checkpoint protected until positioning has run.
      if (settleTimer === null) {
        settleTimer = setTimeout(() => {
          active = false;
          if (scrollTarget.current === target) scrollTarget.current = null;
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
      scrollTarget.current = null;
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
    if (!restored || pendingOlder.current) return;
    saveFeedHistory(snapshotNow());
    if (!positionPending) persistNow();
  }, [feed.stories, feed.pagination, positionPending, restored]);

  useEffect(() => {
    if (!restored) return;
    const onScroll = () => {
      if (pendingOlder.current) return;
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
        !positionSettled.current ||
        pendingOlder.current ||
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

  function resumeOlder() {
    const checkpoint = pendingOlder.current;
    if (!checkpoint) return;
    if (
      !checkpoint.snapshot.pagination.expiresAt ||
      Date.parse(checkpoint.snapshot.pagination.expiresAt) <= Date.now()
    ) {
      pendingOlder.current = null;
      canPersist.current = true;
      clearHomeFeedCheckpoint();
      setResumeNotice("expired");
      persistNow();
      return;
    }
    pendingOlder.current = null;
    canPersist.current = true;
    positionSettled.current = false;
    scrollTarget.current = {
      y: checkpoint.snapshot.scrollY,
      storyId: checkpoint.anchor?.storyId ?? null,
      offset: checkpoint.anchor?.offset ?? null,
      focusStoryId: checkpoint.anchor?.storyId ?? checkpoint.snapshot.stories[0]?.hn_id ?? null,
    };
    setPositionPending(true);
    setResumeNotice("none");
    const next: FeedState = {
      stories: checkpoint.snapshot.stories,
      pagination: checkpoint.snapshot.pagination,
      phase: "idle",
      announcement: "",
    };
    feedRef.current = next;
    setFeed(next);
  }

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
      resumeNotice === "older" ||
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
        if (!positionSettled.current || pendingOlder.current) return;
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
    resumeNotice,
  ]);

  const rows = (stories: PublicFeedStory[]) =>
    stories.map((story, index) => (
      <li key={story.hn_id} data-home-story-id={story.hn_id}>
        <StoryRow
          story={story}
          variant={ranked ? "ranked" : "unranked"}
          feedPosition={ranked ? (initialPagination.page - 1) * 10 + index + 1 : undefined}
        />
      </li>
    ));
  const groups = new Map<string, PublicFeedStory[]>();
  if (groupByDay) {
    for (const story of feed.stories) {
      const day = story.date_added.slice(0, 10);
      const group = groups.get(day) ?? [];
      group.push(story);
      groups.set(day, group);
    }
  }

  return (
    <>
      {resumeNotice === "older" && (
        <div className="home-feed-resume">
          <p role="status">
            Your previous reading place is still available. The latest stories are shown below.
          </p>
          <div className="home-feed-actions">
            <button className="button" type="button" onClick={resumeOlder}>
              Continue where you left off
            </button>
            <button className="button" type="button" onClick={useFreshFeed}>
              Keep latest stories
            </button>
          </div>
        </div>
      )}
      {resumeNotice === "expired" && (
        <p className="home-feed-resume" role="status">
          Your saved story selection expired. The latest stories are shown below.
        </p>
      )}
      {feed.stories.length === 0 ? (
        (emptyState ?? (
          <div className="empty">
            <h2>No stories yet.</h2>
            <p>Stories will appear after the next update.</p>
          </div>
        ))
      ) : groupByDay ? (
        [...groups].map(([day, stories]) => (
          <section key={day} aria-labelledby={`day-${day}`}>
            <div className="feed-bar">
              <h2 id={`day-${day}`}>
                <time dateTime={day}>
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </time>
              </h2>
            </div>
            <ul className="story-list">{rows(stories)}</ul>
          </section>
        ))
      ) : ranked ? (
        <ol
          className="story-list"
          start={initialPagination.page > 1 ? (initialPagination.page - 1) * 10 + 1 : undefined}
          onClickCapture={(event) => {
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
            if (pendingOlder.current) useFreshFeed();
            cancelCheckpointTimer();
            persistNow();
          }}
        >
          {rows(feed.stories)}
        </ol>
      ) : (
        <ul className="story-list">{rows(feed.stories)}</ul>
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
        {restored && !positionPending && feed.phase === "failed" && (
          <div className="home-feed-actions">
            <button className="button" type="button" onClick={() => void load("manual")}>
              Try loading again
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
        <nav className="home-feed-pages" aria-label="Story pages">
          {initialPagination.page > 1 && (!ranked || initialPagination.previousCursor) && (
            <Link
              href={pageURL(initialPagination.page - 1, initialPagination.previousCursor)}
              prefetch={false}
            >
              Newer stories
            </Link>
          )}
          {feed.pagination.hasMore && (!ranked || feed.pagination.cursor) && (
            <Link href={pageURL(feed.pagination.page + 1, feed.pagination.cursor)} prefetch={false}>
              Next page
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
