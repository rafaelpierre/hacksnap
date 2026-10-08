import { ArrowUpRight, ChevronDown, ChevronRight, MessageCircle, Star } from "lucide-react";
import { StoryVisit } from "../../journey-analytics";
import type { RelatedStory, Story } from "../../../lib/data";
import { categoryById, categoryURL } from "../../../lib/categories";
import { domain } from "../../../lib/format";
import { storyDiscussion, storySource } from "../../../lib/story-presentation";
import { DiscussionAnalysis } from "../../discussion-analysis";
import discussionStyles from "../../discussion-analysis.module.css";
import { SkepticismPill } from "../../skepticism-pill";
import { ShareLinks } from "../../share-links";
import { briefExcerpt } from "../../../lib/brief";
import { StoryAge } from "../../story-age";
import { CategoryBadge } from "../../categories";
import { RelatedStories } from "../../related-stories";
import { StoryReturnLink } from "../../story-navigation";
import { ArticleImage } from "../../article-image";
import { canonicalArticleImage } from "../../../lib/article-image";
import type { ReactNode } from "react";

function StoryShare({ story, placement }: { story: Story; placement: "story_top" | "story_end" }) {
  return (
    <ShareLinks
      slug={story.story_slug}
      id={story.hn_id}
      title={story.title}
      takeaway={story.summary?.overall_takeaway}
      placement={placement}
    />
  );
}

export function StoryContent({
  story,
  relatedStories,
  relatedSection,
}: {
  story: Story;
  relatedStories?: RelatedStory[];
  relatedSection?: ReactNode;
}) {
  const summary = story.summary;
  const deck = briefExcerpt(summary?.overall_takeaway);
  const fullTakeaway = summary?.overall_takeaway?.trim().replace(/\s+/g, " ");
  const source = storySource(story.url, summary);
  const article = source.article;
  const discussion = storyDiscussion(summary);
  const hnURL = `https://news.ycombinator.com/item?id=${story.hn_id}`;
  const category = categoryById(story.category);
  const image = canonicalArticleImage(story);

  return (
    <article className="detail">
      <StoryVisit id={story.hn_id} />
      <header className="story-header">
        <nav className="story-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li>
              <StoryReturnLink destination={{ href: "/", label: "Latest" }} />
            </li>
            {category && (
              <li>
                <ChevronRight size={14} aria-hidden="true" />
                <StoryReturnLink
                  destination={{ href: categoryURL(category), label: category.label }}
                />
              </li>
            )}
          </ol>
        </nav>
        <div className="story-context">
          {category && <CategoryBadge id={category.id} />}
          {category && (
            <span className="meta-divider" aria-hidden="true">
              ·
            </span>
          )}
          <StoryAge dateTime={new Date(story.date_added).toISOString()} />
        </div>
        <h1>{story.title}</h1>
        {deck && <p className="standfirst">{deck}</p>}
        <ArticleImage
          image={image}
          alt=""
          className="story-article-image"
          loading="eager"
          fetchPriority="high"
          sizes="(min-width: 78rem) 43rem, (min-width: 60rem) calc(100vw - 21rem), calc(100vw - 4rem)"
        />
        <div className="story-stats">
          <span>
            <Star size={16} aria-hidden="true" /> {story.points} points
          </span>
          <a href={hnURL}>
            <MessageCircle size={16} aria-hidden="true" /> {story.comment_count} comments
          </a>
        </div>
        <nav className="detail-nav" aria-label="Story sections">
          {summary && (
            <>
              <a href="#article-brief">Article brief</a>
              <a href="#discussion-analysis">Discussion analysis</a>
            </>
          )}
          <StoryShare story={story} placement="story_top" />
        </nav>
      </header>
      {summary ? (
        <div className="editorial">
          <section
            id="article-brief"
            className="tldr-section detail-section"
            aria-labelledby="article-heading"
            tabIndex={-1}
          >
            <h2 id="article-heading">Article brief</h2>
            {fullTakeaway && deck !== fullTakeaway && <p>{fullTakeaway}</p>}
            {source.brief === "available" ? (
              <>
                <p>{summary.article_summary}</p>
                {summary.article_key_points.length > 0 && (
                  <ul className="key-points">
                    {summary.article_key_points.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="muted">
                {source.brief === "unavailable"
                  ? "The original article was unavailable to summarize. You can still read the source and the discussion."
                  : source.kind === "article"
                    ? "No article brief is available. You can read the original source and the discussion."
                    : "This is an HN post. The discussion is summarized below."}
              </p>
            )}
            <div className="story-source-actions">
              {article && (
                <a href={article} aria-label={`Original article on ${domain(story.url)}`}>
                  {source.brief === "available"
                    ? "Read original article"
                    : "Open the original source"}
                  <ArrowUpRight className="inline-icon" aria-hidden="true" />
                </a>
              )}
              <a href={hnURL}>
                Open Hacker News thread <ArrowUpRight className="inline-icon" aria-hidden="true" />
              </a>
            </div>
          </section>
          <section
            id="discussion-analysis"
            className="discussion-section detail-section"
            tabIndex={-1}
            aria-labelledby="discussion-themes-heading"
          >
            {discussion.kind === "analysis" ? (
              <DiscussionAnalysis
                analysis={discussion.analysis}
                coverage={summary.discussion_analysis_coverage}
                analyzedAt={summary.discussion_analyzed_at}
              />
            ) : (
              <>
                <div className="discussion-heading">
                  <h2 id="discussion-themes-heading" className="discussion-title">
                    <span>Discussion analysis</span>
                  </h2>
                </div>
                {discussion.kind === "legacy" && discussion.topics.length ? (
                  <div className={discussionStyles.root}>
                    <div className="analysis-themes">
                      {discussion.topics.map((point, i) => (
                        <div className="analysis-theme" key={i}>
                          <details className="analysis-theme-details">
                            <summary>
                              <span>{point.title}</span>
                              <ChevronDown className="analysis-theme-chevron" aria-hidden="true" />
                            </summary>
                            <div className="analysis-theme-body">
                              <p>{point.summary}</p>
                              {point.comment_ids.length > 0 && (
                                <div className="comment-links">
                                  <span>Source comments</span>
                                  {point.comment_ids.map((comment, index) => (
                                    <a
                                      key={comment}
                                      href={`https://news.ycombinator.com/item?id=${comment}`}
                                      aria-label={`Source comment ${comment} for ${point.title}`}
                                    >
                                      [{index + 1}]{" "}
                                      <ArrowUpRight className="inline-icon" aria-hidden="true" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    {discussion.kind === "legacy"
                      ? "No distinct themes were identified in this summary."
                      : "No usable discussion was available for this summary."}{" "}
                    <a href={hnURL}>
                      Read the HN thread <ArrowUpRight className="inline-icon" aria-hidden="true" />
                    </a>
                  </p>
                )}
                <div className="skepticism">
                  <SkepticismPill story={story} />
                  <p>Estimates describe sampled comments, not the whole community.</p>
                </div>
              </>
            )}
          </section>
        </div>
      ) : (
        <section className="story-pending" aria-labelledby="pending-heading">
          <h2 id="pending-heading">Summary pending</h2>
          <p>
            This story has not been summarized yet.{" "}
            {article ? (
              <>
                Read the{" "}
                <a href={article}>
                  original source <ArrowUpRight className="inline-icon" aria-hidden="true" />
                </a>{" "}
                or the{" "}
                <a href={hnURL}>
                  HN discussion <ArrowUpRight className="inline-icon" aria-hidden="true" />
                </a>
                .
              </>
            ) : (
              <>
                Read the{" "}
                <a href={hnURL}>
                  HN post and discussion <ArrowUpRight className="inline-icon" aria-hidden="true" />
                </a>
                .
              </>
            )}
          </p>
        </section>
      )}
      <div className="story-end-share">
        <StoryShare story={story} placement="story_end" />
      </div>
      {relatedSection ?? (
        <RelatedStories
          category={category}
          stories={relatedStories ?? []}
          currentId={story.hn_id}
        />
      )}
    </article>
  );
}
