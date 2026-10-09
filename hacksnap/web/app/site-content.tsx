import { Suspense, type ReactNode } from "react";
import type { PopularPeriod } from "../lib/popular-stories";
import { waitForPrimaryContent } from "../lib/primary-content";
import { shouldStreamBrowse } from "../lib/browse-streaming";
import { PopularStories, PopularStoriesLoading } from "./popular-stories";

async function SitePopularity({ period }: { period: PopularPeriod }) {
  const stream = await shouldStreamBrowse();
  await waitForPrimaryContent();
  return stream ? (
    <Suspense fallback={<PopularStoriesLoading period={period} />}>
      <PopularStories period={period} />
    </Suspense>
  ) : (
    await PopularStories({ period })
  );
}

export function SiteContent({ children }: { children: ReactNode }) {
  return (
    <div className="browse-content browse-content-with-sidebar">
      <div className="browse-feed-content">{children}</div>
      <div className="browse-right-sidebar">
        <SitePopularity period="last-7-days" />
        <SitePopularity period="all-time" />
      </div>
    </div>
  );
}
