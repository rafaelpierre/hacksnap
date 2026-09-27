import { MessageCircle } from "lucide-react";
import type { Story } from "../lib/data";
import { skepticismDisplay } from "../lib/sentiment";

export function SkepticismPill({story}: {story: Story}) {
  const coverage = story.summary?.source_coverage;
  const count = coverage?.sentiment?.included_comments ?? coverage?.included_comments;
  const {label} = skepticismDisplay(story.summary?.sentiment ?? null, count === 0);
  const explanation = label === "No comments"
    ? "No usable comments were available to estimate skepticism."
    : label === "Pending"
      ? "Skepticism is unavailable until the comments are analyzed."
      : `${label} skepticism in a sample of thread comments. Mixed, neutral and positive reactions are grouped as Low.`;
  const display = label === "No comments" ? "No comment evidence" : label === "Pending" ? "Skepticism pending" : `${label} skepticism`;
  return <span className={`skepticism-pill skepticism-${label.toLowerCase().replace(" ", "-")}`} title={explanation} aria-label={explanation}>
    <MessageCircle size={14} aria-hidden="true" /> {display}
  </span>;
}
