"use client";
import { useLayoutEffect, type RefObject, type Dispatch, type SetStateAction } from "react";
import type { PublicFeedStory } from "../../lib/stories-api";
export type ScrollTarget = {
  y: number;
  storyId: string | null;
  offset: number | null;
  focusStoryId: string | null;
};

const POSITION_SETTLE_MS = 2000;
export function useFeedScrollRestoration({
  stories,
  restored,
  scrollTarget,
  positionSettled,
  setPinnedStoryId,
  setPositionPending,
}: {
  stories: PublicFeedStory[];
  restored: boolean;
  scrollTarget: RefObject<ScrollTarget | null>;
  positionSettled: RefObject<boolean>;
  setPinnedStoryId: Dispatch<SetStateAction<string | null>>;
  setPositionPending: Dispatch<SetStateAction<boolean>>;
}) {
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
          `[data-home-story-id="${target.focusStoryId}"] .feed-story-title a`,
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
  }, [stories, restored]);
}
