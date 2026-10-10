"use client";
import { useEffect, useState, useTransition, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { browsePageURL } from "../../lib/archive";
import { storyPath } from "../../lib/story-url";
import { track } from "../../lib/analytics";
import { validBrowseContext, type BrowseContext } from "../../lib/navigation-context";
import { plainClick } from "../../lib/plain-link-click";
import { openStoryDocument } from "../../lib/story-navigation-platform";
import {
  cancelPendingJourney,
  prepareJourney,
  readJourney,
  readJourneyHomeFeedRef,
  journeyToken,
  recordBrowseJourney,
  rememberJourneyReturn,
  restoreListPosition,
} from "../../lib/story-journey";

export function useBrowseStoryLink({
  id,
  slug,
  anchor,
  feedPosition,
  focusFeedStory,
}: {
  id: string;
  slug?: string | null;
  anchor?: "discussion-analysis";
  feedPosition?: number;
  focusFeedStory: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `${storyPath(id, slug)}${anchor ? `#${anchor}` : ""}`;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && feedPosition && feedPosition > 10) {
      track("home_story_open", { story_id: id, position: feedPosition, placement: "home_feed" });
    }
    if (!plainClick(event)) return;
    const { journey, context, homeFeedRef } = recordBrowseJourney(id, focusFeedStory);
    event.preventDefault();
    if (openStoryDocument(href, journey)) return;
    prepareJourney(href, journey, context, homeFeedRef);
    startTransition(() => router.push(href));
  }
  function openAux(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 1 && feedPosition && feedPosition > 10)
      track("home_story_open", {
        story_id: id,
        position: feedPosition,
        placement: "home_feed",
      });
  }
  return { href, open, openAux, pending };
}

export function useNextStoryLink(id: string, slug?: string | null) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = storyPath(id, slug);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!plainClick(event)) return;
    const token = journeyToken();
    const journey = readJourney(token) ? token : null;
    event.preventDefault();
    const context = readJourney(journey);
    const homeFeedRef = context ? readJourneyHomeFeedRef(journey, context.url) : null;
    if (openStoryDocument(href, journey)) return;
    prepareJourney(href, journey, context, homeFeedRef);
    startTransition(() => router.push(href));
  }
  return { href, open, pending };
}

export function useStoryReturnLink(
  destination: { href: string; label: string } | undefined,
  archiveOnly: boolean,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [context, setContext] = useState<BrowseContext | null>(null);
  useEffect(() => {
    function updateContext(event?: PopStateEvent) {
      if (event) cancelPendingJourney();
      const saved = readJourney(journeyToken());
      const path = saved?.url.split("?")[0];
      const matches = archiveOnly
        ? path === "/" || isDatedFeed(saved?.url)
        : !destination ||
          (saved && browsePageURL(saved.url, 1) === destination.href) ||
          (destination.href === "/" && isDatedFeed(saved?.url));
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
    rememberJourneyReturn(context);
  }
  return { context, rememberReturn };
}

export function useListPositionRestorer() {
  useEffect(restoreListPosition, []);
}
export function isDatedFeed(url: string | undefined): boolean {
  return /^\/[1-9]\d{3}\/(0[1-9]|1[0-2])(?:\?|$)/.test(url ?? "");
}

export function useStoryJourney() {
  const pathname = usePathname();
  useEffect(() => {
    function updateJourney(event?: PopStateEvent) {
      if (event) cancelPendingJourney();
      journeyToken();
    }
    updateJourney();
    window.addEventListener("popstate", updateJourney);
    return () => window.removeEventListener("popstate", updateJourney);
  }, [pathname]);
}
