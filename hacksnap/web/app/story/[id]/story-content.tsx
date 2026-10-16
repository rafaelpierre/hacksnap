import { ArrowRight } from "lucide-react";
import { StoryVisit, SectionExposure } from "../../journey-analytics";
import { ArticleReading } from "../../article-reading";
import { readingContext, readingSection } from "../../../lib/reading-metadata";
import type { RelatedStory, Story } from "../../../lib/data";
import { categoryById } from "../../../lib/categories";
import { storyDiscussion, storySource } from "../../../lib/story-presentation";
import { DiscussionAnalysis } from "../../discussion-analysis";
import discussionStyles from "../../discussion-analysis.module.css";
import { SkepticismPill } from "../../skepticism-pill";
import { StoryRail } from "../../story-rail";
import { ShareLinks } from "../../share-links";
import { briefExcerpt } from "../../../lib/brief";
import { StoryJourney } from "../../story-navigation";
import { ArticleSummary, SummaryInline } from "../../summary-text";
import { StoryAge } from "../../story-age";
import { CategoryBadge } from "../../categories";
import { RelatedStories } from "../../related-stories";
import { ArticleImage } from "../../article-image";
import { canonicalArticleImage } from "../../../lib/article-image";
import type { ReactNode } from "react";
import { StructuredData } from "../../structured-data";
import { storyStructuredData } from "../../../lib/structured-data";

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
    <ArticleReading context={readingContext(story)} sourceURL={article}>
      <StructuredData data={storyStructuredData(story)} />
      <StoryVisit id={story.hn_id} category={category?.id} ready={!!summary} />
      <StoryJourney />
      <header
        className="story-header"
        {...readingSection("opening", story.title + " " + (deck ?? ""))}
      >
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
        <StoryRail id={story.hn_id} points={story.points} commentCount={story.comment_count}>
          <StoryShare story={story} placement="story_top" />
        </StoryRail>
      </header>
      {summary ? (
        <div className="editorial">
          <section
            id="article-brief"
            className="tldr-section detail-section"
            aria-label="Article summary"
            tabIndex={-1}
            {...readingSection(
              "brief",
              [
                fullTakeaway && deck !== fullTakeaway ? fullTakeaway : "",
                source.brief === "available" ? summary.article_summary : "",
                ...summary.article_key_points,
              ].join(" "),
            )}
          >
            <SectionExposure storyId={story.hn_id} section="summary" />
            {fullTakeaway && deck !== fullTakeaway && <p>{fullTakeaway}</p>}
            {source.brief === "available" ? (
              <>
                <ArticleSummary text={summary.article_summary ?? ""} />
                {summary.article_key_points.length > 0 && (
                  <>
                    <h2 className="key-points-heading">The bits that matter</h2>
                    <ul
                      className="key-points"
                      {...readingSection("key_points", summary.article_key_points.join(" "))}
                    >
                      {summary.article_key_points.map((point, i) => (
                        <li key={i}>
                          <SummaryInline text={point} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <p className="muted">
                {source.brief === "unavailable"
                  ? "The original article was unavailable to summarize."
                  : source.kind === "article"
                    ? "No article brief is available."
                    : "This is an HN post. The discussion is summarized below."}
              </p>
            )}
          </section>
          <section
            id="discussion-analysis"
            className="discussion-section detail-section"
            tabIndex={-1}
            aria-labelledby="discussion-themes-heading"
          >
            <SectionExposure storyId={story.hn_id} section="discussion" />
            {discussion.kind === "analysis" ? (
              <DiscussionAnalysis
                analysis={discussion.analysis}
                coverage={summary.discussion_analysis_coverage}
                analyzedAt={summary.discussion_analyzed_at}
              />
            ) : (
              <>
                <div
                  className="discussion-heading"
                  {...readingSection("discussion", "Discussion analysis")}
                >
                  <h2 id="discussion-themes-heading" className="discussion-title">
                    <span>Discussion analysis</span>
                  </h2>
                </div>
                {discussion.kind === "legacy" && discussion.topics.length ? (
                  <div className={discussionStyles.root}>
                    <div className="analysis-themes">
                      {discussion.topics.map((point, i) => (
                        <div className="analysis-theme" key={i}>
                          <section className="analysis-theme-section">
                            <h3 {...readingSection("theme_heading", point.title, i + 1)}>
                              <span>{point.title}</span>
                            </h3>
                            <div
                              className="analysis-theme-body"
                              {...readingSection("theme_body", point.summary, i + 1)}
                            >
                              <p>
                                <SummaryInline text={point.summary} />
                              </p>
                            </div>
                          </section>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    {discussion.kind === "legacy"
                      ? "No distinct themes were identified in this summary."
                      : "No usable discussion was available for this summary."}{" "}
                    <a href={hnURL} target="_blank" rel="noopener noreferrer">
                      Read the HN thread <ArrowRight className="inline-icon" aria-hidden="true" />
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
        <section
          className="story-pending"
          aria-labelledby="pending-heading"
          {...readingSection("pending")}
        >
          <h2 id="pending-heading">Summary pending</h2>
          <p>
            This story has not been summarized yet.{" "}
            {article ? (
              <>
                Read the{" "}
                <a href={article} target="_blank" rel="noopener noreferrer">
                  original source <ArrowRight className="inline-icon" aria-hidden="true" />
                </a>{" "}
                or the{" "}
                <a href={hnURL} target="_blank" rel="noopener noreferrer">
                  HN discussion <ArrowRight className="inline-icon" aria-hidden="true" />
                </a>
                .
              </>
            ) : (
              <>
                Read the{" "}
                <a href={hnURL} target="_blank" rel="noopener noreferrer">
                  HN post and discussion <ArrowRight className="inline-icon" aria-hidden="true" />
                </a>
                .
              </>
            )}
          </p>
        </section>
      )}
      {relatedSection ?? (
        <RelatedStories
          category={category}
          stories={relatedStories ?? []}
          currentId={story.hn_id}
        />
      )}
    </ArticleReading>
  );
}
