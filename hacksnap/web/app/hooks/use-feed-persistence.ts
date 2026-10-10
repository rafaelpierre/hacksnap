"use client";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { FeedSnapshot } from "../../lib/feed-state";
import type { FeedState } from "./feed-types";
import { clearHomeFeedCheckpoint } from "../../lib/home-feed-checkpoint";
import { consumeFeedReturn, saveFeedHistory } from "../../lib/story-journey";
import { useFeedScrollRestoration, type ScrollTarget } from "./use-feed-scroll-restoration";
const HISTORY_SAVE_DELAY_MS = 400;
function currentURL() {
  return window.location.pathname + window.location.search;
}

export function useFeedPersistence({
  feed,
  feedRef,
  setFeed,
  activeRequest,
  requestId,
  latest,
  initialPage,
}: {
  feed: FeedState;
  feedRef: RefObject<FeedState>;
  setFeed: Dispatch<SetStateAction<FeedState>>;
  activeRequest: RefObject<AbortController | null>;
  requestId: RefObject<number>;
  latest: boolean;
  initialPage: number;
}) {
  const [startingPage, setStartingPage] = useState(initialPage);
  const [restored, setRestored] = useState(false);
  const [restoredFromSnapshot, setRestoredFromSnapshot] = useState(false);
  const [positionPending, setPositionPending] = useState(false);
  const initialized = useRef(false);
  const canPersist = useRef(false);
  const positionSettled = useRef(true);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTarget = useRef<ScrollTarget | null>(null);
  const [pinnedStoryId, setPinnedStoryId] = useState<string | null>(null);
  function snapshotNow(): FeedSnapshot {
    const current = feedRef.current;
    return {
      version: 3,
      url: currentURL(),
      stories: current.stories,
      leadStoryId: current.leadStoryId,
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
        leadStoryId: snapshot.leadStoryId ?? snapshot.stories[0]?.hn_id ?? null,
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

  useFeedScrollRestoration({
    stories: feed.stories,
    restored,
    scrollTarget,
    positionSettled,
    setPinnedStoryId,
    setPositionPending,
  });

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

  function flushHistory() {
    cancelHistoryTimer();
    persistNow();
  }
  return {
    startingPage,
    restored,
    restoredFromSnapshot,
    positionPending,
    positionSettled,
    pinnedStoryId,
    flushHistory,
  };
}
