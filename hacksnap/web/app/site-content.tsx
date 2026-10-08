import { Suspense, type ReactNode } from "react";
import { waitForPrimaryContent } from "../lib/primary-content";
import { shouldStreamBrowse } from "../lib/browse-streaming";
import { PopularStories, PopularStoriesLoading } from "./popular-stories";

async function SitePopularity() {
  const stream = await shouldStreamBrowse();
  await waitForPrimaryContent();
  return stream ? (
    <Suspense fallback={<PopularStoriesLoading />}>
      <PopularStories />
    </Suspense>
  ) : (
    await PopularStories()
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
