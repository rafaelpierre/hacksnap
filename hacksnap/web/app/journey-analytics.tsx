"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { analyticsRouteIdentity, startJourneyTracking, track } from "../lib/analytics";
import { analyticsAllowed, subscribeAnalyticsConsent } from "../lib/analytics-consent";
import { markStoryOpened } from "../lib/story-history";
import { storyIdFromSlug } from "../lib/story-url";

const ROUTE_EVENT = "hacksnap:analytics-route";
let restoredDocument = 0;
function subscribeRoute(listener: () => void) {
  window.addEventListener(ROUTE_EVENT, listener);
  return () => window.removeEventListener(ROUTE_EVENT, listener);
}
function currentRoute() {
  return `${analyticsRouteIdentity(window.location.pathname, window.location.search)}:${restoredDocument}`;
}
// Only ReaderVisit reads Next search params, inside its existing Suspense
// boundary. Cards and article content must remain server-renderable with ISR.
function useAnalyticsRoute() {
  return useSyncExternalStore(subscribeRoute, currentRoute, () => "");
}

export function ReaderVisit() {
  const path = usePathname();
  const search = useSearchParams();
  const route = analyticsRouteIdentity(path ?? "/", search?.toString() ?? "");
  useEffect(() => {
    track("reader_visit", {}, "visit");
    window.dispatchEvent(new window.Event(ROUTE_EVENT));
  }, [route]);
  useEffect(() => {
    const unsubscribe = startJourneyTracking();
    function restored(event: PageTransitionEvent) {
      if (!event.persisted) return;
      restoredDocument++;
      window.dispatchEvent(new window.Event(ROUTE_EVENT));
    }
    window.addEventListener("pageshow", restored);
    function storyClick(event: MouseEvent) {
      if (
        (event.type === "click" && event.button !== 0) ||
        (event.type === "auxclick" && event.button !== 1)
      )
        return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      try {
        const url = new URL(link.href, window.location.href);
        if (link.closest(".share-panel")) return;
        const card = link.closest<HTMLElement>("[data-home-story-id]");
        const detail = document.querySelector<HTMLElement>(".detail[data-story-id]");
        if (url.origin !== window.location.origin) {
          const storyId = card?.dataset.homeStoryId ?? detail?.dataset.storyId;
          if (!storyId || !/^https?:$/.test(url.protocol)) return;
          const destination =
            url.hostname === "news.ycombinator.com"
              ? url.searchParams.get("id") === storyId
                ? "hn_thread"
                : "hn_comment"
              : "article";
          track("outbound_click", {
            story_id: storyId,
            destination,
            placement: card ? "feed" : "story",
          });
          return;
        }
        const match = /^\/story\/([^/]+)\/?$/.exec(url.pathname);
        const id = match ? storyIdFromSlug(match[1]) : null;
        if (id) {
          const position = Number(card?.getAttribute("aria-posinset"));
          const fields = {
            story_id: id,
            placement: card ? "feed" : link.closest(".related-stories") ? "read_next" : "most_read",
            ...(position > 0 ? { position } : {}),
            ...(card?.dataset.categoryId ? { category_id: card.dataset.categoryId } : {}),
          };
          if (card) track("feed_story_exposure", fields, `feed-exposure:${id}:${position}`);
          track("story_click", fields, `story-click:${id}`);
        }
      } catch {
        /* Malformed and unrelated links are not story activations. */
      }
    }
    document.addEventListener("click", storyClick, true);
    document.addEventListener("auxclick", storyClick, true);
    return () => {
      unsubscribe();
      window.removeEventListener("pageshow", restored);
      document.removeEventListener("click", storyClick, true);
      document.removeEventListener("auxclick", storyClick, true);
    };
  }, []);
  return null;
}

export function StoryVisit({
  id,
  category,
  ready = true,
}: {
  id: string;
  category?: string;
  ready?: boolean;
}) {
  const route = useAnalyticsRoute();
  useEffect(() => {
    track(
      "story_view",
      { story_id: id, category_id: category, summary_state: ready ? "ready" : "pending" },
      `story:${id}`,
    );
    markStoryOpened(id);
  }, [id, route, category, ready]);
  return null;
}

/** Exposure means at least half the recommendation is visible, not merely rendered. */
export function Recommendation({
  source,
  target,
  position,
  children,
}: {
  source: string;
  target: string;
  position: number;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const allowed = useSyncExternalStore(subscribeAnalyticsConsent, analyticsAllowed, () => false);
  const route = useAnalyticsRoute();
  const params = { story_id: source, target_story_id: target, position, placement: "read_next" };
  const key = `recommendation:${source}:${target}:${position}`;
  function expose() {
    track("recommendation_exposure", params, key);
  }
  useEffect(() => {
    if (!allowed || !root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          track(
            "recommendation_exposure",
            { story_id: source, target_story_id: target, position, placement: "read_next" },
            key,
          );
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [source, target, position, key, route, allowed]);
  function click(event: React.MouseEvent) {
    if (!(event.target instanceof Element) || !event.target.closest("a")) return;
    // A click proves exposure even before the observer fires (or without observer support).
    expose();
    track("recommendation_click", params, `click:${key}`);
  }
  return (
    <div
      ref={root}
      data-analytics-placement="read_next"
      onClickCapture={click}
      onAuxClickCapture={(event) => {
        if (event.button === 1) click(event);
      }}
    >
      {children}
    </div>
  );
}

export function SectionExposure({
  storyId,
  section,
}: {
  storyId: string;
  section: "summary" | "discussion" | "read_next";
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const route = useAnalyticsRoute();
  const allowed = useSyncExternalStore(subscribeAnalyticsConsent, analyticsAllowed, () => false);
  useEffect(() => {
    if (!allowed || !marker.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          track(
            "story_section_view",
            { story_id: storyId, section },
            `section:${storyId}:${section}`,
          );
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(marker.current);
    return () => observer.disconnect();
  }, [allowed, route, storyId, section]);
  return <span ref={marker} aria-hidden="true" style={{ display: "block", height: 1 }} />;
}

export function useFeedExposure(
  element: React.RefObject<HTMLElement | null>,
  storyId: string,
  position: number,
  category?: string | null,
) {
  const allowed = useSyncExternalStore(subscribeAnalyticsConsent, analyticsAllowed, () => false);
  const route = useAnalyticsRoute();
  useEffect(() => {
    if (!allowed || !element.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          track(
            "feed_story_exposure",
            { story_id: storyId, position, category_id: category ?? undefined, placement: "feed" },
            `feed-exposure:${storyId}:${position}`,
          );
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [allowed, element, route, storyId, position, category]);
}
