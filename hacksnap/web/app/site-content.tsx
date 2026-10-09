import { Suspense, type ReactNode } from "react";
import { waitForPrimaryContent } from "../lib/primary-content";
import { shouldStreamBrowse } from "../lib/browse-streaming";
import { PopularStories, PopularStoriesLoading } from "./popular-stories";

async function PopularityContent({ content }: { content: Promise<ReactNode> }) {
  return await content;
}

async function SitePopularity() {
  const stream = await shouldStreamBrowse();
  await waitForPrimaryContent();
  // Release the single reader connection before starting the weekly aggregate.
  // PopularStories handles failures, so Trending still runs if Most read fails.
  const lifetime = PopularStories();
  const trending = lifetime.then(() => PopularStories({ period: "last-7-days" }));
  return stream ? (
    <>
      <Suspense fallback={<PopularStoriesLoading period="last-7-days" />}>
        <PopularityContent content={trending} />
      </Suspense>
      <Suspense fallback={<PopularStoriesLoading />}>
        <PopularityContent content={lifetime} />
      </Suspense>
    </>
  ) : (
    <>
      {await trending}
      {await lifetime}
    </>
  );
}

export function SiteContent({ children }: { children: ReactNode }) {
  return (
    <div className="browse-content browse-content-with-sidebar">
      <div className="browse-feed-content">{children}</div>
      <div className="browse-right-sidebar">
        <SitePopularity />
      </div>
    </div>
  );
}
