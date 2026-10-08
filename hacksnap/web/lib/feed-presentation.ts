import type { ArticleStory } from "./story-domain";
import { briefExcerpt } from "./brief";
import { storyDiscussion } from "./story-presentation";

export type LeadDiscussionPreview = { storyId: string; text: string };

/** The current analysis owns this preview; legacy briefs do not stand in for it. */
export function leadDiscussionPreview(story: ArticleStory | null): LeadDiscussionPreview | null {
  if (!story) return null;
  const discussion = storyDiscussion(story.summary);
  if (discussion.kind !== "analysis" || discussion.status !== "available") return null;
  const text = discussion.topics
    .map((topic) => topic.summary.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  return text ? { storyId: story.hn_id, text: briefExcerpt(text) } : null;
}

/** Optional detail must never prevent a usable listing from rendering. */
export async function readLeadDiscussionPreview(
  storyId: string | null,
  readStory: (id: string) => Promise<ArticleStory | null>,
): Promise<LeadDiscussionPreview | null> {
  if (!storyId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const story = await Promise.race([
      readStory(storyId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 500);
      }),
    ]);
    return story?.hn_id === storyId ? leadDiscussionPreview(story) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
