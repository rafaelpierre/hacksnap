import { getPopularStories } from "../lib/data";
import { BrowseStoryLink } from "./story-navigation";

function PopularStoriesShell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="popular-stories" aria-labelledby="popular-stories-heading">
      <div className="popular-stories-heading">
        <h2 id="popular-stories-heading">Most read</h2>
        <span>All time</span>
      </div>
      {children}
    </aside>
  );
}

export function PopularStoriesLoading() {
  return (
    <PopularStoriesShell>
      <p className="sr-only" role="status">
        Loading most read stories…
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

/** Popularity is optional: a failed read must never replace the main feed. */
export async function PopularStories() {
  try {
    const stories = await getPopularStories();
    return (
      <PopularStoriesShell>
        {stories.length ? (
          <ol>
            {stories.slice(0, 5).map((story) => (
              <li key={story.hn_id}>
                <BrowseStoryLink id={story.hn_id} slug={story.story_slug}>
                  {story.title}
                </BrowseStoryLink>
              </li>
            ))}
          </ol>
        ) : (
          <p className="popular-stories-status">Most read stories will appear as readers visit.</p>
        )}
      </PopularStoriesShell>
    );
  } catch {
    return (
      <PopularStoriesShell>
        <p className="popular-stories-status">Most read stories are temporarily unavailable.</p>
      </PopularStoriesShell>
    );
  }
}
