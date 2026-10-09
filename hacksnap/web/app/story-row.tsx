import { Sparkles } from "lucide-react";
import { StoryRail } from "./story-rail";
import { ShareLinks } from "./share-links";
import type { CardStory } from "../lib/story-domain";
import type { PublicFeedStory } from "../lib/stories-api";
import { CategoryBadge } from "./categories";
import { briefExcerpt } from "../lib/brief";
import { BrowseStoryLink } from "./story-navigation";
import { StoryAge } from "./story-age";
import { ArticleImage } from "./article-image";
import { canonicalArticleImage } from "../lib/article-image";

const FEED_IMAGE_SIZES =
  "(min-width: 78rem) min(calc(100vw - 41.5rem - 2px), 41.875rem), (min-width: 60rem) min(calc(100vw - 22rem - 2px), 41.875rem), (min-width: 42rem) min(calc(100vw - 8rem - 2px), 41.875rem), (max-width: 26rem) calc(100vw - 4rem - 2px), calc(100vw - 5rem - 2px)";

export function StoryRow({
  story,
  variant = "unranked",
  feedPosition,
  opened = false,
  leadImage = false,
  lead = false,
}: {
  story: CardStory | PublicFeedStory;
  variant?: "ranked" | "unranked";
  feedPosition?: number;
  opened?: boolean;
  leadImage?: boolean;
  showCategory?: boolean;
  lead?: boolean;
}) {
  const takeaway = story.summary?.overall_takeaway?.trim();
  const discussionPreview = story.summary?.discussion_preview?.trim();
  const image = canonicalArticleImage(story);
  const showArchive = variant === "ranked" && story.is_recent === false;

  return (
    <article className={`story-row feed-story${lead ? " feed-story-lead" : ""}`}>
      <div className="story-domain story-context">
        {story.category && <CategoryBadge id={story.category} />}
        {story.category && (
          <span className="meta-divider" aria-hidden="true">
            ·
          </span>
        )}
        <StoryAge
          dateTime={
            typeof story.date_added === "string" ? story.date_added : story.date_added.toISOString()
          }
        />
        {showArchive && <span className="archive-label">Archive</span>}
      </div>
      <h2 className={`feed-story-title${opened ? " story-title-opened" : ""}`}>
        <BrowseStoryLink id={story.hn_id} slug={story.story_slug} feedPosition={feedPosition}>
          {story.title}
        </BrowseStoryLink>
      </h2>
      {takeaway ? (
        <p className="feed-excerpt">{briefExcerpt(takeaway)}</p>
      ) : (
        <p className="feed-excerpt feed-pending">
          Brief pending. Check back after the next summary update.
        </p>
      )}
      {discussionPreview && (
        <div className="feed-discussion-preview">
          <h3>
            <Sparkles aria-hidden="true" />
            <span>Discussion summary</span>
          </h3>
          <p>{briefExcerpt(discussionPreview)}</p>
        </div>
      )}
      <ArticleImage
        image={image}
        alt=""
        className="feed-story-image"
        loading={leadImage ? "eager" : "lazy"}
        fetchPriority={leadImage ? "high" : undefined}
        sizes={FEED_IMAGE_SIZES}
      />
      <div className="story-content">
        <StoryRail id={story.hn_id} points={story.points} commentCount={story.comment_count}>
          <ShareLinks
            id={story.hn_id}
            slug={story.story_slug}
            title={story.title}
            takeaway={takeaway}
          />
        </StoryRail>
      </div>
    </article>
  );
}
