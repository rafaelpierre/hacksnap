import { ArrowUp, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

export function StoryRail({
  id,
  points,
  commentCount,
  children,
}: {
  id: string;
  points: number;
  commentCount: number;
  children?: ReactNode;
}) {
  return (
    <div className="feed-story-rail">
      <span className="feed-stat" title={`${points.toLocaleString("en-GB")} points`}>
        <ArrowUp size={18} aria-hidden="true" />
        <span>
          {points.toLocaleString("en-GB")}
          <span className="sr-only"> points</span>
        </span>
      </span>
      <a
        className="feed-stat feed-comments"
        href={`https://news.ycombinator.com/item?id=${id}`}
        title={`${commentCount.toLocaleString("en-GB")} comments`}
      >
        <MessageCircle size={18} aria-hidden="true" />
        <span>
          {commentCount.toLocaleString("en-GB")}
          <span className="sr-only"> comments</span>
        </span>
      </a>
      {children}
    </div>
  );
}
