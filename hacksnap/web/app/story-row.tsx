import { MessageCircle, Star } from "lucide-react";
import type { CardStory } from "../lib/story-domain";
import type { PublicFeedStory } from "../lib/stories-api";
import { CategoryBadge } from "./categories";
import { briefExcerpt } from "../lib/brief";
import type { LeadDiscussionPreview } from "../lib/feed-presentation";
import { ShareLinks } from "./share-links";
import { BrowseStoryLink } from "./story-navigation";
import { StoryAge } from "./story-age";
import { ArticleImage } from "./article-image";
import { canonicalArticleImage } from "../lib/article-image";

const FEED_IMAGE_SIZES =
  "(min-width: 78rem) min(calc(100vw - 41.5rem - 2px), 41.875rem), (min-width: 60rem) min(calc(100vw - 22rem - 2px), 41.875rem), (min-width: 42rem) min(calc(100vw - 8rem - 2px), 41.875rem), (max-width: 26rem) calc(100vw - 4rem - 2px), calc(100vw - 5rem - 2px)";
const LEAD_IMAGE_SIZES =
  "(min-width: 78rem) min(calc(100vw - 42.5rem - 2px), 40.875rem), (min-width: 60rem) min(calc(100vw - 23rem - 2px), 40.875rem), (min-width: 42rem) min(calc(100vw - 8rem - 2px), 41.875rem), (max-width: 26rem) calc(100vw - 4rem - 2px), calc(100vw - 5rem - 2px)";

export function StoryRow({
  story,
  variant = "unranked",
  feedPosition,
  opened = false,
  leadImage = false,
  lead = false,
  discussionPreview,
}: {
  story: CardStory | PublicFeedStory;
  variant?: "ranked" | "unranked";
  feedPosition?: number;
  opened?: boolean;
  leadImage?: boolean;
  showCategory?: boolean;
  lead?: boolean;
  discussionPreview?: LeadDiscussionPreview | null;
}) {
  const takeaway = story.summary?.overall_takeaway?.trim();
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
      <ArticleImage
        image={image}
        alt=""
        className="feed-story-image"
        loading={leadImage ? "eager" : "lazy"}
        fetchPriority={leadImage ? "high" : undefined}
        sizes={lead ? LEAD_IMAGE_SIZES : FEED_IMAGE_SIZES}
      />
      <div className="story-content">
        {takeaway ? (
          <p className="feed-excerpt">{briefExcerpt(takeaway)}</p>
        ) : (
          <p className="feed-excerpt feed-pending">
            Brief pending. Check back after the next summary update.
          </p>
        )}
        {lead && discussionPreview?.storyId === story.hn_id && (
          <div className="feed-discussion-preview">
            <h3>Inside the discussion</h3>
            <p>{discussionPreview.text}</p>
          </div>
        )}
        <div className="story-meta">
          <span className="points" title={`${story.points.toLocaleString("en-GB")} points`}>
            <Star size={14} aria-hidden="true" />
            <span>
              {story.points.toLocaleString("en-GB")}
              <span> points</span>
            </span>
          </span>
          <a
            href={`https://news.ycombinator.com/item?id=${story.hn_id}`}
            title={`${story.comment_count.toLocaleString("en-GB")} comments`}
          >
            <MessageCircle size={14} aria-hidden="true" />
            <span>
              {story.comment_count.toLocaleString("en-GB")}
              <span> comments</span>
            </span>
          </a>
        </div>
        <div className="feed-story-actions">
          <span className={lead ? "feed-read-brief feed-read-brief-primary" : "feed-read-brief"}>
            <BrowseStoryLink id={story.hn_id} slug={story.story_slug} feedPosition={feedPosition}>
              Read brief
            </BrowseStoryLink>
          </span>
          <span className="feed-discussion-link">
            <BrowseStoryLink
              id={story.hn_id}
              slug={story.story_slug}
              feedPosition={feedPosition}
              anchor="discussion-analysis"
            >
              <MessageCircle size={16} aria-hidden="true" />
              Discussion analysis
            </BrowseStoryLink>
          </span>
          <ShareLinks
            slug={story.story_slug}
            id={story.hn_id}
            title={story.title}
            takeaway={takeaway}
          />
        </div>
      </div>
    </article>
  );
}
