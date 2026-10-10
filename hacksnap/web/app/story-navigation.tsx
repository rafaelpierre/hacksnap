"use client";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import {
  useBrowseStoryLink,
  useNextStoryLink,
  useStoryReturnLink,
  useListPositionRestorer,
  useStoryJourney,
  isDatedFeed,
} from "./hooks/use-story-navigation";
export { saveFeedHistory, consumeFeedReturn } from "../lib/story-journey";

export function BrowseStoryLink({
  id,
  slug,
  anchor,
  feedPosition,
  focusFeedStory = true,
  children,
}: {
  id: string;
  slug?: string | null;
  anchor?: "discussion-analysis";
  feedPosition?: number;
  focusFeedStory?: boolean;
  children: ReactNode;
}) {
  const { href, open, openAux, pending } = useBrowseStoryLink({
    id,
    slug,
    anchor,
    feedPosition,
    focusFeedStory,
  });
  return (
    <Link href={href} onClick={open} onAuxClick={openAux} aria-busy={pending || undefined}>
      {children}
    </Link>
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
  const { href, open, pending } = useNextStoryLink(id, slug);
  return (
    <Link href={href} onClick={open} aria-busy={pending || undefined}>
      {children}
    </Link>
  );
}

export function StoryJourney() {
  useStoryJourney();
  return null;
}

export function StoryReturnLink({
  destination,
  archiveOnly = false,
}: { destination?: { href: string; label: string }; archiveOnly?: boolean } = {}) {
  const { context, rememberReturn } = useStoryReturnLink(destination, archiveOnly);
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
      {destination?.href === "/" && isDatedFeed(context?.url)
        ? context?.label
        : (destination?.label ?? context?.label ?? "Latest stories")}
    </Link>
  );
}

export function ListPositionRestorer() {
  useListPositionRestorer();
  return null;
}
