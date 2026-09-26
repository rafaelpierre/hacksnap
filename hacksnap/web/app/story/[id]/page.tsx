import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { storyPreviewMetadata } from "../../../lib/preview-metadata";
import { getRelatedStories, getStory, type Story } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { articleURL, domain } from "../../../lib/format";
import { skepticismDisplay } from "../../../lib/sentiment";
import { ShareLinks } from "../../share-links";
import { briefExcerpt } from "../../../lib/brief";
import { CategoryBadge } from "../../categories";
import { RelatedStories } from "../../related-stories";
import { StoryReturnLink } from "../../story-navigation";

export const revalidate = 1800;

export async function generateStaticParams() { return []; }

export async function generateMetadata({params}: {params: Promise<{id: string}>}): Promise<Metadata> {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  return storyPreviewMetadata(story);
}

function StoryShare({story}: {story: Story}) {
  return <ShareLinks id={story.hn_id} title={story.title} takeaway={story.summary?.overall_takeaway} />;
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

export default async function StoryPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  const summary = story.summary;
  const deck = briefExcerpt(summary?.overall_takeaway);
  const fullTakeaway = summary?.overall_takeaway?.trim().replace(/\s+/g, " ");
  const article = articleURL(story.url);
  const hnURL = `https://news.ycombinator.com/item?id=${story.hn_id}`;
  const category = categoryById(story.category);
  const relatedStories = category ? await getRelatedStories(category.id, story.hn_id) : [];
  const hasDiscussion = Boolean(summary?.discussion_summary?.trim() && summary.source_coverage.included_comments > 0);

  return <article className="detail">
    <div className="story-actions">
      <StoryReturnLink />
      <StoryShare story={story} />
    </div>
    <header className="story-header">
      <div className="story-byline story-context">{story.category && <CategoryBadge id={story.category} />}{article ? <a href={article} aria-label={`Original article on ${domain(story.url)}`}>{domain(story.url)} ↗</a> : <a href={hnURL}>Hacker News ↗</a>}</div>
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
        {article && !summary.article_summary && <p><a href={article}>Open the original source ↗</a></p>}
      </section>
      <section className="discussion-section" aria-labelledby="discussion-heading">
        <div className="discussion-heading"><h2 id="discussion-heading">Discussion</h2><SkepticismPill story={story} /></div>
        {hasDiscussion ? <>
          <p>{summary.discussion_summary}</p>
          <div className="discussion-points">{summary.discussion_points.map((point, i) => <section className="discussion-point" key={i}>
            <h3>{point.title}</h3><p>{point.summary}</p>
            {point.comment_ids.length > 0 && <div className="comment-links"><span>Source comments</span>{point.comment_ids.map((comment, index) => <a key={comment} href={`https://news.ycombinator.com/item?id=${comment}`} aria-label={`Source comment ${comment} for ${point.title}`}>[{index + 1}] ↗</a>)}</div>}
          </section>)}</div>
        </> : <p className="muted">No usable discussion was available for this summary. <a href={hnURL}>Read the HN thread ↗</a></p>}
      </section>
    </div> : <section className="story-pending" aria-labelledby="pending-heading">
      <h2 id="pending-heading">Summary pending</h2>
      <p>This story has not been summarized yet. {article ? <>Read the <a href={article}>original source ↗</a> or the <a href={hnURL}>HN discussion ↗</a>.</> : <>Read the <a href={hnURL}>HN post and discussion ↗</a>.</>}</p>
    </section>}
    <div className="story-end-share"><StoryShare story={story} /></div>
    <RelatedStories category={category} stories={relatedStories} currentId={story.hn_id} />
  </article>;
}
