import Link from "next/link";
import { storyPreviewMetadata } from "../../../lib/preview-metadata";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStory } from "../../../lib/data";
import { articleURL, domain, timestamp } from "../../../lib/format";

export const revalidate = 1800;

// Generate stories on their first visit, then share the cached page.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({params}: {params: Promise<{id: string}>}): Promise<Metadata> {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  return storyPreviewMetadata(story);
}

export default async function StoryPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  const summary = story.summary;
  const article = articleURL(story.url);
  return <article className="detail">
    <Link className="back-link" href="/">← All stories</Link>
    <header className="story-header">
      <div className="channel-path">ai / <span>{domain(story.url)}</span></div>
      <h1>{story.title}</h1>
      <div className="story-meta"><span className="points">{story.points.toLocaleString("en-GB")} points</span><a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>{story.comment_count.toLocaleString("en-GB")} comments on HN ↗</a></div>
      {summary && <p className="standfirst">{summary.overall_takeaway}</p>}
      <div className="source-links">{article && <a href={article}>Read original ↗</a>}<a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>Full discussion ↗</a></div>
    </header>
    {summary ? <div className="editorial">
      <section aria-labelledby="article-heading">
        <h2 id="article-heading">{article ? "The brief" : "The post"}</h2>
        {summary.article_summary ? <>
          <p>{summary.article_summary}</p>
          {summary.article_key_points.length > 0 && <ul className="key-points">{summary.article_key_points.map((point, i) => <li key={i}>{point}</li>)}</ul>}
        </> : <p className="muted">{summary.source_coverage.article_status === "unavailable" ? "The original article couldn’t be retrieved. This brief covers the discussion only." : "An HN text post. The discussion is summarized below."}</p>}
      </section>
      <section className="discussion-section" aria-labelledby="discussion-heading">
        <h2 id="discussion-heading">In the discussion</h2>
        <p>{summary.discussion_summary}</p>
        <div className="discussion-points">{summary.discussion_points.map((point, i) => <section className="discussion-point" key={i}>
          <h3>{point.title}</h3><p>{point.summary}</p>
          {point.comment_ids.length > 0 && <div className="comment-links"><span>Sources</span>{point.comment_ids.map((comment, index) => <a key={comment} href={`https://news.ycombinator.com/item?id=${comment}`} aria-label={`Source comment ${comment} for ${point.title}`}>[{index + 1}] ↗</a>)}</div>}
        </section>)}</div>
      </section>
      <aside className="source-note">
        <p>AI-generated summary · <time dateTime={summary.generated_at}>{timestamp(summary.generated_at)}</time></p>
        <details><summary>Sources &amp; coverage · {summary.source_coverage.included_comments} comments sampled</summary>
          <p>Based on {summary.source_coverage.included_comments} of {summary.source_coverage.stored_comments} usable stored comments, selected by depth and branch activity. This is a sample of the discussion.{summary.source_coverage.comments_truncated ? " The model input was further shortened to fit its context limit." : ""} Article text may also be shortened.</p>
          <p>Generated using {summary.model}. Check the linked sources for full context.</p>
        </details>
      </aside>
    </div> : <section className="empty"><h2>Summary pending.</h2><p>Summaries update hourly. You can read the original sources above.</p></section>}
  </article>;
}
