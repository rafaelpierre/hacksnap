import { ArrowUp, ArrowUpRight, MessageCircle } from "lucide-react";
import type { Story } from "../lib/data";
import { CategoryBadge } from "./categories";
import { briefExcerpt } from "../lib/brief";
import { ShareLinks } from "./share-links";
import { BrowseStoryLink } from "./story-navigation";

export function StoryRow({story, variant = "unranked"}: {story: Story; variant?: "ranked" | "unranked"}) {
  const rank = variant === "ranked" ? Number(story.rank) : null;
  const hasRank = rank !== null && Number.isInteger(rank) && rank > 0;
  const takeaway = story.summary?.overall_takeaway?.trim();

  return <article className={`story-row feed-story ${hasRank ? "feed-story-ranked" : "feed-story-unranked"}${rank === 1 ? " feed-story-lead" : ""}`}>
    <div className="story-content">
      <div className="story-domain story-context">
        {hasRank && <span className="rank" aria-label={`Rank ${rank}`}>{String(rank).padStart(2, "0")}</span>}
        {story.category && <CategoryBadge id={story.category} />}
        {variant === "ranked" && story.is_recent === false && <span className="archive-label">Archive</span>}
      </div>
      <h3><BrowseStoryLink id={story.hn_id}>{story.title}</BrowseStoryLink></h3>
      {takeaway ? <p className="feed-excerpt">{briefExcerpt(takeaway)}</p> : <p className="feed-excerpt feed-pending">Brief pending. Check back after the next summary update.</p>}
      <div className="feed-story-footer">
        <div className="story-meta">
          <span className="points"><ArrowUp size={14} aria-hidden="true" />{story.points.toLocaleString("en-GB")} points</span>
          <a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}><MessageCircle size={14} aria-hidden="true" />{story.comment_count.toLocaleString("en-GB")} comments <ArrowUpRight className="inline-icon" aria-hidden="true" /></a>
        </div>
        <ShareLinks id={story.hn_id} title={story.title} takeaway={takeaway} />
      </div>
    </div>
  </article>;
}
