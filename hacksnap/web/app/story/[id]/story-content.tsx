import { ArrowUpRight, ChevronRight, MessagesSquare } from "lucide-react";
import { StoryVisit } from "../../journey-analytics";
import type { RelatedStory, Story } from "../../../lib/data";
import { categoryById, categoryURL } from "../../../lib/categories";
import { domain } from "../../../lib/format";
import { storyDiscussion, storySource } from "../../../lib/story-presentation";
import { DiscussionAnalysis } from "../../discussion-analysis";
import { SkepticismPill } from "../../skepticism-pill";
import { ShareLinks } from "../../share-links";
import { discussionBriefBlocks } from "../../../lib/discussion-brief";
import { briefExcerpt } from "../../../lib/brief";
import { StoryAddedTime } from "../../story-added-time";
import { RelatedStories } from "../../related-stories";
import { StoryReturnLink } from "../../story-navigation";
import { ArticleImage } from "../../article-image";
import { canonicalArticleImage } from "../../../lib/article-image";
import type { ReactNode } from "react";

function DiscussionIntroduction({ text }: { text: string }) {
  return discussionBriefBlocks(text).map((block, index) =>
    block.type === "paragraph" ? (
      <p key={index}>{block.text}</p>
    ) : (
      <ul className="key-points" key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{item}</li>
        ))}
      </ul>
    ),
  );
}

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
              <StoryReturnLink destination={{ href: "/", label: "Top Stories" }} />
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
          <StoryReturnLink archiveOnly />
        </nav>
        <h1>{story.title}</h1>
        {deck && <p className="standfirst">{deck}</p>}
        <ArticleImage
          image={image}
          alt=""
          className="story-article-image"
          loading="eager"
          fetchPriority="high"
          sizes="(max-width: 720px) calc(100vw - 2rem), 43rem"
        />
        <div className="story-metadata">
          <div className="story-source-date">
            {article ? (
              <a
                className="story-source"
                href={article}
                aria-label={`Original article on ${domain(story.url)}`}
              >
                {domain(story.url)} <ArrowUpRight className="inline-icon" aria-hidden="true" />
              </a>
            ) : (
              <a className="story-source" href={hnURL}>
                Hacker News <ArrowUpRight className="inline-icon" aria-hidden="true" />
              </a>
            )}
            <span className="story-added">
              Added <StoryAddedTime dateTime={new Date(story.date_added).toISOString()} />
            </span>
          </div>
          <StoryShare story={story} placement="story_top" />
        </div>
      </header>
      {summary ? (
        <div className="editorial">
          <section className="tldr-section" aria-labelledby="article-heading">
            <h2 id="article-heading">TLDR;</h2>
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
            {article && source.brief !== "available" && (
              <p>
                <a href={article}>
                  Open the original source{" "}
                  <ArrowUpRight className="inline-icon" aria-hidden="true" />
                </a>
              </p>
            )}
          </section>
          <section
            id="discussion-analysis"
            className="discussion-section"
            aria-labelledby="discussion-heading"
          >
            <div className="discussion-heading">
              <h2 id="discussion-heading" className="discussion-title">
                <MessagesSquare className="discussion-title-icon" aria-hidden="true" />
                <span>Discussion</span>
              </h2>
              {discussion.kind !== "analysis" && <SkepticismPill story={story} />}
            </div>
            {discussion.kind === "analysis" ? (
              <>
                {summary.discussion_summary.trim() && discussion.status !== "no_comments" && (
                  <>
                    <p className="muted">
                      Legacy summary sample: {discussion.legacyCoverage.included_comments} of{" "}
                      {discussion.legacyCoverage.stored_comments} usable stored comments.
                    </p>
                    <DiscussionIntroduction text={summary.discussion_summary} />
                  </>
                )}
                <DiscussionAnalysis
                  analysis={discussion.analysis}
                  coverage={summary.discussion_analysis_coverage}
                  analyzedAt={summary.discussion_analyzed_at}
                  hnURL={hnURL}
                />
              </>
            ) : discussion.kind === "legacy" ? (
              <>
                <DiscussionIntroduction text={summary.discussion_summary} />
                <div className="discussion-points">
                  {discussion.topics.map((point, i) => (
                    <section className="discussion-point" key={i}>
                      <h3>{point.title}</h3>
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
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                No usable discussion was available for this summary.{" "}
                <a href={hnURL}>
                  Read the HN thread <ArrowUpRight className="inline-icon" aria-hidden="true" />
                </a>
              </p>
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
