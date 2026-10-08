import { Suspense, type ReactNode } from "react";
import { shouldStreamBrowse } from "../lib/browse-streaming";
import { PopularStories, PopularStoriesLoading } from "./popular-stories";

export async function SiteContent({ children }: { children: ReactNode }) {
  const stream = await shouldStreamBrowse();
  const popularity = stream ? (
    <Suspense fallback={<PopularStoriesLoading />}>
      <PopularStories />
    </Suspense>
  ) : (
    await PopularStories()
  );

  return (
    <div className="browse-content browse-content-with-sidebar">
      <div className="browse-feed-content">{children}</div>
      <div className="browse-right-sidebar">{popularity}</div>
    </div>
  );
}
