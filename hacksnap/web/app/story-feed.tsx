"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { browsePageURL } from "../lib/archive";
import type { PublicFeedStory } from "../lib/stories-api";
import type { FeedPagination } from "../lib/feed-state";
import { WindowedStoryList } from "./windowed-story-list";
import { useStoryFeed } from "./hooks/use-story-feed";

export function StoryFeed({
  initialStories,
  initialPagination,
  listingPath = "/",
  groupByDay = false,
  showCategory = true,
  emptyState,
  leadStoryId = initialStories[0]?.hn_id ?? null,
}: {
  initialStories: PublicFeedStory[];
  initialPagination: FeedPagination;
  listingPath?: string;
  groupByDay?: boolean;
  showCategory?: boolean;
  emptyState?: ReactNode;
  leadStoryId?: string | null;
}) {
  const {
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
  } = useStoryFeed({ initialStories, initialPagination, listingPath, leadStoryId });
  const pageURL = (page: number) => browsePageURL(listingPath, page);
  const hasNewerPage = startingPage > 1;
  const hasOlderPage = feed.pagination.hasMore;
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
          leadStoryId={feed.leadStoryId}
          showCategory={showCategory}
          ranked={false}
          openedIds={openedIds}
          initialPage={startingPage}
          groupByDay={groupByDay}
          pinnedStoryId={pinnedStoryId}
          // The first image must be eager in server HTML, before restoration runs.
          leadImagePriority={!restored || (!restoredFromSnapshot && !positionPending)}
          onStoryTitleClickCapture={flushHistory}
        />
      )}
      <div ref={sentinel} className="home-feed-sentinel" aria-hidden="true" />
      <div
        className="home-feed-continuation"
        onFocusCapture={focusContinuation}
        onBlurCapture={blurContinuation}
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
                onClick={loadManually}
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
