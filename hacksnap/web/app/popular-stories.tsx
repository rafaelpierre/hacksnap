import type { PopularPeriod } from "../lib/popular-stories";
import { getPopularStories } from "../lib/data";
import { BrowseStoryLink } from "./story-navigation";

function PopularStoriesShell({
  children,
  period,
}: {
  children: React.ReactNode;
  period: PopularPeriod;
}) {
  const heading = period === "last-7-days" ? "trending-stories-heading" : "popular-stories-heading";
  return (
    <aside className="popular-stories" aria-labelledby={heading}>
      <div className="popular-stories-heading">
        <h2 id={heading}>{period === "last-7-days" ? "Trending this week" : "Most read"}</h2>
        {period === "all-time" && <p>Across all time</p>}
      </div>
      {children}
    </aside>
  );
}

export function PopularStoriesLoading({ period = "all-time" }: { period?: PopularPeriod } = {}) {
  return (
    <PopularStoriesShell period={period}>
      <p className="sr-only" role="status">
        {period === "last-7-days" ? "Loading trending stories…" : "Loading most read stories…"}
      </p>
      <ol aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index}>
            <span className="popular-stories-placeholder" />
          </li>
        ))}
      </ol>
    </PopularStoriesShell>
  );
}

/** Each optional read has its own Suspense boundary and failure state. */
export async function PopularStories({ period = "all-time" }: { period?: PopularPeriod } = {}) {
  try {
    const stories = await getPopularStories(period);
    return (
      <PopularStoriesShell period={period}>
        {stories.length ? (
          <ol>
            {stories.slice(0, 5).map((story) => (
              <li key={story.hn_id}>
                <BrowseStoryLink id={story.hn_id} slug={story.story_slug} focusFeedStory={false}>
                  {story.title}
                </BrowseStoryLink>
              </li>
            ))}
          </ol>
        ) : (
          <p className="popular-stories-status">
            {period === "last-7-days"
              ? "No story reads recorded in the last 7 days."
              : "Most read stories will appear as readers visit."}
          </p>
        )}
      </PopularStoriesShell>
    );
  } catch {
    return (
      <PopularStoriesShell period={period}>
        <p className="popular-stories-status">
          {period === "last-7-days"
            ? "Trending stories are temporarily unavailable."
            : "Most read stories are temporarily unavailable."}
        </p>
      </PopularStoriesShell>
    );
  }
}
