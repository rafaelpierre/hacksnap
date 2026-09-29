"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PublicReadyStory } from "../lib/stories-api";
import {
  appendUniqueStories,
  homePageURL,
  validHomeFeedPage,
  type HomeFeedPagination,
  type HomeFeedSnapshot,
} from "../lib/home-feed-state";
import { track } from "../lib/analytics";
import { StoryRow } from "./story-row";
import { consumeHomeFeedReturn, saveHomeFeedHistory } from "./story-navigation";

type FeedState = {
  stories: PublicReadyStory[];
  pagination: HomeFeedPagination;
  phase: "idle" | "loading" | "failed" | "expired";
  announcement: string;
};

export function HomeStoryFeed({
  initialStories,
  initialPagination,
}: {
  initialStories: PublicReadyStory[];
  initialPagination: HomeFeedPagination;
}) {
  const [feed, setFeed] = useState<FeedState>({
    stories: initialStories,
    pagination: initialPagination,
    phase: "idle",
    announcement: "",
  });
  const [restored, setRestored] = useState(false);
  const feedRef = useRef(feed);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const scrollTarget = useRef<{ y: number; storyId: string | null } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const lastAutoY = useRef<number | null>(null);
  const [autoReady, setAutoReady] = useState(true);
  const [autoPaused, setAutoPaused] = useState(false);
  const url =
    typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;
  feedRef.current = feed;

  useEffect(() => {
    const snapshot = consumeHomeFeedReturn(window.location.pathname + window.location.search);
    if (snapshot) {
      scrollTarget.current = { y: snapshot.scrollY, storyId: snapshot.focusStoryId };
      const next = {
        stories: snapshot.stories,
        pagination: snapshot.pagination,
        phase: "idle" as const,
        announcement: "",
      };
      feedRef.current = next;
      setFeed(next);
    }
    setRestored(true);
    const onPopState = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      requestId.current++;
      const restoredPage = consumeHomeFeedReturn(window.location.pathname + window.location.search);
      if (!restoredPage) return;
      scrollTarget.current = { y: restoredPage.scrollY, storyId: restoredPage.focusStoryId };
      const next = {
        stories: restoredPage.stories,
        pagination: restoredPage.pagination,
        phase: "idle" as const,
        announcement: "",
      };
      feedRef.current = next;
      setFeed(next);
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
    scrollTarget.current = null;
    const frame = requestAnimationFrame(() => {
      if (target.storyId) {
        const link = document.querySelector<HTMLAnchorElement>(
          `[data-home-story-id="${target.storyId}"] h3 a`,
        );
        link?.focus({ preventScroll: true });
      }
      window.scrollTo({ top: target.y, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [feed.stories, restored]);

  useEffect(() => {
    if (!restored) return;
    const snapshot: HomeFeedSnapshot = {
      version: 1,
      url,
      stories: feed.stories,
      pagination: feed.pagination,
      scrollY: window.scrollY,
      focusStoryId: null,
      savedAt: Date.now(),
    };
    saveHomeFeedHistory(snapshot);
  }, [feed.stories, feed.pagination, restored, url]);

  useEffect(() => {
    if (!restored || feed.pagination.hasMore) return;
    track(
      "home_feed_end",
      {
        outcome: feed.pagination.selectionLimited ? "selection_limited" : "exhausted",
        position: feed.stories.length,
        placement: "home_feed",
      },
      `home-end:${feed.pagination.page}`,
    );
  }, [feed.pagination, feed.stories.length, restored]);

  const load = useCallback(async (trigger: "auto" | "manual") => {
    const current = feedRef.current;
    if (
      activeRequest.current ||
      current.phase === "expired" ||
      !current.pagination.hasMore ||
      !current.pagination.cursor
    )
      return;
    const controller = new AbortController();
    const id = ++requestId.current;
    activeRequest.current = controller;
    setFeed((state) => ({ ...state, phase: "loading", announcement: "" }));
    try {
      const query = new URLSearchParams({ cursor: current.pagination.cursor });
      const response = await fetch(`/api/ready-stories?${query}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (id !== requestId.current || controller.signal.aborted) return;
      if (response.status === 410) {
        setFeed((state) => ({ ...state, phase: "expired" }));
        track("home_feed_load", { outcome: "expired", trigger, position: current.stories.length });
        return;
      }
      if (!response.ok) throw new Error("Story load failed");
      const page = validHomeFeedPage(await response.json());
      if (!page || page.pagination.page !== current.pagination.page + 1)
        throw new Error("Invalid story page");
      if (id !== requestId.current || controller.signal.aborted) return;
      const stories = appendUniqueStories(current.stories, page.stories);
      if (stories.length === current.stories.length && page.pagination.hasMore)
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
      track("home_feed_load", {
        outcome: page.stories.length ? "success" : "empty",
        trigger,
        position: stories.length,
      });
    } catch {
      if (id === requestId.current && !controller.signal.aborted) {
        setFeed((state) => ({ ...state, phase: "failed" }));
        track("home_feed_load", { outcome: "failure", trigger, position: current.stories.length });
      }
    } finally {
      if (id === requestId.current) activeRequest.current = null;
    }
  }, []);

  function skipToFooter() {
    setAutoPaused(true);
    setAutoReady(false);
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestId.current++;
    setFeed((state) => (state.phase === "loading" ? { ...state, phase: "idle" } : state));
  }

  useEffect(() => {
    if (
      !restored ||
      !feed.pagination.hasMore ||
      feed.phase !== "idle" ||
      !autoReady ||
      autoPaused ||
      !sentinel.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        lastAutoY.current = window.scrollY;
        setAutoReady(false);
        void load("auto");
        observer.disconnect();
      },
      { rootMargin: "0px 0px 500px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [autoReady, autoPaused, feed.pagination.hasMore, feed.phase, load, restored]);

  useEffect(() => {
    if (autoReady || lastAutoY.current === null) return;
    const onScroll = () => {
      if (window.scrollY > lastAutoY.current! + 150) setAutoReady(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [autoReady]);

  return (
    <>
      <a className="home-feed-top-skip" href="#site-footer" onClick={skipToFooter}>
        Skip to footer
      </a>
      {feed.stories.length === 0 ? (
        <div className="empty">
          <h2>No stories yet.</h2>
          <p>Stories will appear after the next update.</p>
        </div>
      ) : (
        <ol
          className="story-list"
          start={initialPagination.page > 1 ? (initialPagination.page - 1) * 10 + 1 : undefined}
        >
          {feed.stories.map((story, index) => (
            <li key={story.hn_id} data-home-story-id={story.hn_id}>
              <StoryRow
                story={story}
                variant="ranked"
                feedPosition={(initialPagination.page - 1) * 10 + index + 1}
              />
            </li>
          ))}
        </ol>
      )}
      <div ref={sentinel} className="home-feed-sentinel" aria-hidden="true" />
      <div className="home-feed-continuation">
        <p role="status" aria-live="polite" className="home-feed-status">
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
        {restored && feed.pagination.hasMore && feed.phase !== "expired" && (
          <div className="home-feed-actions">
            <button
              className="button"
              type="button"
              disabled={feed.phase === "loading"}
              onClick={() => void load("manual")}
            >
              {feed.phase === "failed" ? "Try loading again" : "Load more stories"}
            </button>
            <button
              className="button"
              type="button"
              aria-pressed={autoPaused}
              onClick={() => setAutoPaused((value) => !value)}
            >
              {autoPaused ? "Resume automatic loading" : "Pause automatic loading"}
            </button>
          </div>
        )}
        {autoPaused && feed.pagination.hasMore && (
          <p className="home-feed-hint">Automatic loading paused. Load more when you’re ready.</p>
        )}
        {feed.phase === "expired" && (
          <a className="button" href="/">
            Start a fresh selection
          </a>
        )}
        <a className="home-feed-footer-link" href="#site-footer" onClick={skipToFooter}>
          Skip to footer
        </a>
        <nav className="home-feed-pages" aria-label="Story pages">
          {initialPagination.page > 1 && initialPagination.previousCursor && (
            <Link
              href={homePageURL(initialPagination.page - 1, initialPagination.previousCursor)}
              prefetch={false}
            >
              Newer stories
            </Link>
          )}
          {feed.pagination.hasMore && feed.pagination.cursor && (
            <Link
              href={homePageURL(feed.pagination.page + 1, feed.pagination.cursor)}
              prefetch={false}
            >
              Next page
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
