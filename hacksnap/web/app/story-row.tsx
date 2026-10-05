import { MessageCircle, Star } from "lucide-react";
import type { CardStory } from "../lib/story-domain";
import type { PublicFeedStory } from "../lib/stories-api";
import { CategoryBadge } from "./categories";
import { briefExcerpt } from "../lib/brief";
import { SkepticismPill } from "./skepticism-pill";
import { ShareLinks } from "./share-links";
import { BrowseStoryLink } from "./story-navigation";
import { StoryAge } from "./story-age";
import { ArticleImage } from "./article-image";
import { canonicalArticleImage } from "../lib/article-image";

const FEED_IMAGE_SIZES =
  "(max-width: 640px) calc(100vw - 4rem), (max-width: 800px) calc(30vw - 1rem), min(calc(30vw - 5rem), 18rem)";

export function StoryRow({
  story,
  variant = "unranked",
  feedPosition,
  opened = false,
  leadImage = false,
  showCategory = true,
}: {
  story: CardStory | PublicFeedStory;
  variant?: "ranked" | "unranked";
  feedPosition?: number;
  opened?: boolean;
  leadImage?: boolean;
  showCategory?: boolean;
}) {
  const takeaway = story.summary?.overall_takeaway?.trim();
  const image = canonicalArticleImage(story);
  const showArchive = variant === "ranked" && story.is_recent === false;

  return (
    <article className="story-row feed-story">
      {((showCategory && story.category) || showArchive) && (
        <div className="story-domain story-context">
          {showCategory && story.category && <CategoryBadge id={story.category} />}
          {showArchive && <span className="archive-label">Archive</span>}
        </div>
      )}
      <h3 className={opened ? "story-title-opened" : undefined}>
        <BrowseStoryLink id={story.hn_id} slug={story.story_slug} feedPosition={feedPosition}>
          {story.title}
        </BrowseStoryLink>
      </h3>
      <ArticleImage
        image={image}
        alt=""
        className="feed-story-image"
        loading={leadImage ? "eager" : "lazy"}
        fetchPriority={leadImage ? "high" : undefined}
        sizes={FEED_IMAGE_SIZES}
      />
      <div className="story-content">
        {takeaway ? (
          <p className="feed-excerpt">{briefExcerpt(takeaway)}</p>
        ) : (
          <p className="feed-excerpt feed-pending">
            Brief pending. Check back after the next summary update.
          </p>
        )}
        <div className="feed-story-footer">
          <div className="story-meta">
            <span className="points" title={`${story.points.toLocaleString("en-GB")} points`}>
              <Star size={14} aria-hidden="true" />
              <span>
                {story.points.toLocaleString("en-GB")}
                <span className="sr-only"> points</span>
              </span>
            </span>
            <a
              href={`https://news.ycombinator.com/item?id=${story.hn_id}`}
              title={`${story.comment_count.toLocaleString("en-GB")} comments`}
            >
              <MessageCircle size={14} aria-hidden="true" />
              <span>
                {story.comment_count.toLocaleString("en-GB")}
                <span className="sr-only"> comments</span>
              </span>
            </a>
            <SkepticismPill story={story} />
            <StoryAge
              dateTime={
                typeof story.date_added === "string"
                  ? story.date_added
                  : story.date_added.toISOString()
              }
            />
          </div>
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
