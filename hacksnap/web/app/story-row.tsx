import { ChevronsDown, ChevronsUp, MessageCircle, Minus, Star } from "lucide-react";
import type { Story } from "../lib/data";
import type { PublicReadyStory } from "../lib/stories-api";
import { CategoryBadge } from "./categories";
import { formatRankChange, latestRankChange } from "../lib/rank-history";
import { briefExcerpt } from "../lib/brief";
import { SkepticismPill } from "./skepticism-pill";
import { ShareLinks } from "./share-links";
import { BrowseStoryLink } from "./story-navigation";
import { ArticleImage } from "./article-image";
import { canonicalArticleImage } from "../lib/article-image";

export function StoryRow({
  story,
  variant = "unranked",
  feedPosition,
}: {
  story: Story | PublicReadyStory;
  variant?: "ranked" | "unranked";
  feedPosition?: number;
}) {
  const rank = variant === "ranked" ? Number(story.rank) : null;
  const hasRank = rank !== null && Number.isInteger(rank) && rank > 0;
  const movement = latestRankChange(story.rank_history ?? [], story.rank ?? undefined);
  const MovementIcon =
    movement === null || movement === 0 ? Minus : movement > 0 ? ChevronsUp : ChevronsDown;
  const movementLabel =
    movement === null
      ? "Hacksnap rank movement unavailable: waiting for two updates"
      : movement === 0
        ? "Hacksnap rank unchanged since the previous update"
        : `${movement > 0 ? "Climbed" : "Dropped"} ${Math.abs(movement)} ${Math.abs(movement) === 1 ? "position" : "positions"} in Hacksnap since the previous update`;
  const takeaway = story.summary?.overall_takeaway?.trim();
  const image = canonicalArticleImage(story);

  return (
    <article
      className={`story-row feed-story ${hasRank ? "feed-story-ranked" : "feed-story-unranked"}${rank === 1 ? " feed-story-lead" : ""}`}
    >
      <div className="story-domain story-context">
        {hasRank && (
          <span className="rank" aria-label={`Rank ${rank}`}>
            {String(rank).padStart(2, "0")}
          </span>
        )}
        {story.category && <CategoryBadge id={story.category} />}
        {variant === "ranked" && story.is_recent === false && (
          <span className="archive-label">Archive</span>
        )}
      </div>
      <ArticleImage image={image} alt="" className="feed-story-image" loading="lazy" />
      <div className="story-content">
        <h3>
          <BrowseStoryLink id={story.hn_id} slug={story.story_slug} feedPosition={feedPosition}>
            {story.title}
          </BrowseStoryLink>
        </h3>
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
            {hasRank && (
              <span className="rank-movement" aria-label={movementLabel} title={movementLabel}>
                <MovementIcon size={16} aria-hidden="true" />
                <span aria-hidden="true">
                  {movement === null ? "—" : formatRankChange(movement)}
                </span>
              </span>
            )}
            <SkepticismPill story={story} />
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
