"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import type { PublicFeedStory } from "../../lib/stories-api";
import { appendUniqueStories, type FeedPagination } from "../../lib/feed-state";
import { fetchFeedPage } from "../../lib/fetch-feed-page";
import {
  emptyStoryHistory,
  readStoryHistory,
  subscribeStoryHistory,
} from "../../lib/story-history";
import type { FeedState } from "./feed-types";
import { useFeedPersistence } from "./use-feed-persistence";

export function useStoryFeed({
  initialStories,
  initialPagination,
  listingPath,
  leadStoryId,
}: {
  initialStories: PublicFeedStory[];
  initialPagination: FeedPagination;
  listingPath: string;
  leadStoryId: string | null;
}) {
  const latest = listingPath.split("?")[0] === "/";
  const [feed, setFeed] = useState<FeedState>({
    leadStoryId,
    stories: initialStories,
    pagination: initialPagination,
    phase: "idle",
    announcement: "",
  });
  const [history, setHistory] = useState(emptyStoryHistory);
  const feedRef = useRef(feed);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const [continuationFocused, setContinuationFocused] = useState(false);
  const [automaticLoadingAvailable, setAutomaticLoadingAvailable] = useState(true);
  const activeTrigger = useRef<"auto" | "manual" | null>(null);
  feedRef.current = feed;
  const {
    startingPage,
    restored,
    restoredFromSnapshot,
    positionPending,
    positionSettled,
    pinnedStoryId,
    flushHistory,
  } = useFeedPersistence({
    feed,
    feedRef,
    setFeed,
    activeRequest,
    requestId,
    latest,
    initialPage: initialPagination.page,
  });
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
        const page = await fetchFeedPage(
          listingPath,
          current.pagination.page + 1,
          controller.signal,
        );
        if (id !== requestId.current || controller.signal.aborted) return;
        const stories = appendUniqueStories(current.stories, page.stories);
        // Live offsets can repeat a whole batch after new arrivals; keep their page advance.
        const added = stories.length - current.stories.length;
        const next = {
          stories,
          leadStoryId: current.leadStoryId,
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

  function focusContinuation() {
    setContinuationFocused(true);
    if (activeRequest.current && activeTrigger.current === "auto") {
      activeRequest.current.abort();
      activeRequest.current = null;
      requestId.current++;
      setFeed((state) => ({ ...state, phase: "idle" }));
    }
  }
  function blurContinuation(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setContinuationFocused(false);
  }
  function loadManually() {
    setContinuationFocused(false);
    void load("manual");
  }
  return {
    feed,
    startingPage,
    restored,
    restoredFromSnapshot,
    positionPending,
    pinnedStoryId,
    openedIds,
    sentinel,
    automaticLoadingAvailable,
    flushHistory,
    focusContinuation,
    blurContinuation,
    loadManually,
  };
}
