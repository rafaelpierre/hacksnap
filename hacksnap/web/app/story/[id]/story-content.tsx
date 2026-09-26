import { ArrowUpRight } from "lucide-react";
import { StoryVisit } from "../../journey-analytics";
import { MessageCircle } from "lucide-react";
import type { RelatedStory, Story } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { articleURL, domain } from "../../../lib/format";
import { skepticismDisplay } from "../../../lib/sentiment";
import { ShareLinks } from "../../share-links";
import { briefExcerpt } from "../../../lib/brief";
import { CategoryBadge } from "../../categories";
import { RelatedStories } from "../../related-stories";
import { StoryReturnLink } from "../../story-navigation";

function StoryShare({story, placement}: {story: Story; placement: "story_top" | "story_end"}) {
  return <ShareLinks id={story.hn_id} title={story.title} takeaway={story.summary?.overall_takeaway} placement={placement} />;
}

function SkepticismPill({story}: {story: Story}) {
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

export function StoryContent({story, relatedStories}: {story: Story; relatedStories: RelatedStory[]}) {
  const summary = story.summary;
  const deck = briefExcerpt(summary?.overall_takeaway);
  const fullTakeaway = summary?.overall_takeaway?.trim().replace(/\s+/g, " ");
  const article = articleURL(story.url);
  const hnURL = `https://news.ycombinator.com/item?id=${story.hn_id}`;
  const category = categoryById(story.category);
  const hasDiscussion = Boolean(summary?.discussion_summary?.trim() && summary.source_coverage.included_comments > 0);

  return <article className="detail">
    <StoryVisit id={story.hn_id} />
    <div className="story-actions">
      <StoryReturnLink />
      <StoryShare story={story} placement="story_top" />
    </div>
    <header className="story-header">
      <div className="story-byline story-context">{story.category && <CategoryBadge id={story.category} />}{article ? <a href={article} aria-label={`Original article on ${domain(story.url)}`}>{domain(story.url)} <ArrowUpRight className="inline-icon" aria-hidden="true" /></a> : <a href={hnURL}>Hacker News <ArrowUpRight className="inline-icon" aria-hidden="true" /></a>}</div>
      <h1>{story.title}</h1>
      {deck && <p className="standfirst">{deck}</p>}
    </header>
    {summary ? <div className="editorial">
      <section className="tldr-section" aria-labelledby="article-heading">
        <h2 id="article-heading">TLDR;</h2>
        {fullTakeaway && deck !== fullTakeaway && <p>{fullTakeaway}</p>}
        {summary.article_summary ? <>
          <p>{summary.article_summary}</p>
          {summary.article_key_points.length > 0 && <ul className="key-points">{summary.article_key_points.map((point, i) => <li key={i}>{point}</li>)}</ul>}
        </> : <p className="muted">{summary.source_coverage.article_status === "unavailable"
          ? "The original article was unavailable to summarize. You can still read the source and the discussion."
          : article ? "No article brief is available. You can read the original source and the discussion."
            : "This is an HN post. The discussion is summarized below."}</p>}
        {article && !summary.article_summary && <p><a href={article}>Open the original source <ArrowUpRight className="inline-icon" aria-hidden="true" /></a></p>}
      </section>
      <section className="discussion-section" aria-labelledby="discussion-heading">
        <div className="discussion-heading"><h2 id="discussion-heading">Discussion</h2><SkepticismPill story={story} /></div>
        {hasDiscussion ? <>
          <p>{summary.discussion_summary}</p>
          <div className="discussion-points">{summary.discussion_points.map((point, i) => <section className="discussion-point" key={i}>
            <h3>{point.title}</h3><p>{point.summary}</p>
            {point.comment_ids.length > 0 && <div className="comment-links"><span>Source comments</span>{point.comment_ids.map((comment, index) => <a key={comment} href={`https://news.ycombinator.com/item?id=${comment}`} aria-label={`Source comment ${comment} for ${point.title}`}>[{index + 1}] <ArrowUpRight className="inline-icon" aria-hidden="true" /></a>)}</div>}
          </section>)}</div>
        </> : <p className="muted">No usable discussion was available for this summary. <a href={hnURL}>Read the HN thread <ArrowUpRight className="inline-icon" aria-hidden="true" /></a></p>}
      </section>
    </div> : <section className="story-pending" aria-labelledby="pending-heading">
      <h2 id="pending-heading">Summary pending</h2>
      <p>This story has not been summarized yet. {article ? <>Read the <a href={article}>original source <ArrowUpRight className="inline-icon" aria-hidden="true" /></a> or the <a href={hnURL}>HN discussion <ArrowUpRight className="inline-icon" aria-hidden="true" /></a>.</> : <>Read the <a href={hnURL}>HN post and discussion <ArrowUpRight className="inline-icon" aria-hidden="true" /></a>.</>}</p>
    </section>}
    <div className="story-end-share"><StoryShare story={story} placement="story_end" /></div>
    <RelatedStories category={category} stories={relatedStories} currentId={story.hn_id} />
  </article>;
}
