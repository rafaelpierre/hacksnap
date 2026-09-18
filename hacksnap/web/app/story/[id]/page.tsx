import Link from "next/link";
import { notFound } from "next/navigation";
import { getStory } from "../../../lib/data";
import { articleURL, domain, timestamp } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function StoryPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const story = await getStory(id);
  if (!story) notFound();
  const summary = story.summary;
  const article = articleURL(story.url);
  return <div className="detail">
    <Link className="back-link" href="/">← Back to the radar</Link>
    <header className="story-header"><div className="eyebrow">THE STORY / {domain(story.url)}</div>
      <h1>{story.title}</h1><div className="metrics"><span className="points">▲ {story.points.toLocaleString("en-GB")} points</span><span>{story.comment_count.toLocaleString("en-GB")} comments on HN</span></div>
      <div className="source-buttons">{article && <a className="button primary" href={article}>Read the original ↗</a>}<a className="button" href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>Join the HN discussion ↗</a></div>
    </header>
    {summary ? <>
      <aside className="takeaway-box"><span className="eyebrow">THE TAKEAWAY</span><p>{summary.overall_takeaway}</p></aside>
      <div className="detail-columns">
        <section className="article-section"><div className="section-label"><span aria-hidden="true">01</span><h2>The article</h2></div>
          {summary.article_summary ? <><p className="section-intro">{summary.article_summary}</p><h3 className="eyebrow">KEY POINTS</h3><ul className="key-points">{summary.article_key_points.map((point, i) => <li key={i}>{point}</li>)}</ul></> :
            <p className="section-intro muted">{summary.source_coverage.article_status === "unavailable" ? "The linked article could not be retrieved. No article summary was generated; the discussion is summarized separately." : "This is an HN post without an external article. The discussion is summarized alongside."}</p>}
        </section>
        <section className="discussion-section"><div className="section-label"><span aria-hidden="true">02</span><h2>The HN discussion</h2></div>
          <p className="section-intro">{summary.discussion_summary}</p>
          <div className="discussion-points">{summary.discussion_points.map((point, i) => <article className="discussion-point" key={i}><h3>{point.title}</h3><p>{point.summary}</p><div className="comment-links">{point.comment_ids.map(comment => <a key={comment} href={`https://news.ycombinator.com/item?id=${comment}`}>Comment #{comment} ↗</a>)}</div></article>)}</div>
        </section>
      </div>
      <aside className="source-note"><span className="eyebrow">ABOUT THIS SNAPSHOT</span><p>Generated <time dateTime={summary.generated_at}>{timestamp(summary.generated_at)}</time> using {summary.model}.</p>
        <p>Based on {summary.source_coverage.included_comments} of {summary.source_coverage.stored_comments} usable stored comments. Ingestion filters comments by depth and branch activity; this is a sample of the discussion.{summary.source_coverage.comments_truncated ? " The model input was further limited to fit its context budget." : ""} Article text may also be shortened.</p>
      </aside>
    </> : <section className="empty"><span className="eyebrow">IN THE QUEUE</span><h2>The summary is on its way.</h2><p>The hourly refresh generates the article brief and discussion highlights. The original sources are available above.</p></section>}
  </div>;
}
