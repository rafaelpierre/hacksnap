import styles from "./discussion-analysis.module.css";
import { SummaryInline } from "./summary-text";
import { DiscussionTopics } from "./discussion-topics";
import { readingSection } from "../lib/reading-metadata";
import { Info, X } from "lucide-react";
import type {
  DiscussionAnalysis as Analysis,
  DiscussionAnalysisCoverage,
} from "../lib/discussion-analysis";

export function DiscussionAnalysis({
  analysis,
  coverage,
  analyzedAt,
}: {
  analysis: Analysis;
  coverage?: DiscussionAnalysisCoverage | null;
  analyzedAt?: string | null;
}) {
  const date = analyzedAt ? new Date(analyzedAt) : null;
  const validDate = date && Number.isFinite(date.getTime()) ? date : null;
  return (
    <div className={`discussion-analysis ${styles.root}`}>
      <div
        className="discussion-heading analysis-heading"
        {...readingSection("discussion", "Discussion analysis")}
      >
        <h2 id="discussion-themes-heading" className="discussion-title">
          <span>Discussion analysis</span>
        </h2>
        <button
          type="button"
          className="analysis-source-info"
          popoverTarget="discussion-analysis-info"
          aria-label="About this discussion analysis"
        >
          <Info size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <div
          id="discussion-analysis-info"
          className="analysis-source-popup"
          popover="auto"
          role="dialog"
          aria-labelledby="discussion-analysis-info-title"
        >
          <div className="analysis-source-header">
            <p id="discussion-analysis-info-title">Analysis details</p>
            <button
              type="button"
              className="analysis-source-close"
              popoverTarget="discussion-analysis-info"
              popoverTargetAction="hide"
              aria-label="Close analysis information"
              autoFocus
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <div className="analysis-coverage">
            <p>
              {coverage
                ? `${coverage.included_comments} ${coverage.included_comments === 1 ? "comment" : "comments"} analyzed.`
                : "Analyzed-comment count unavailable."}{" "}
              {validDate ? (
                <>
                  Analyzed{" "}
                  <time dateTime={validDate.toISOString()}>
                    {new Intl.DateTimeFormat("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "UTC",
                    }).format(validDate)}{" "}
                    UTC
                  </time>
                  .
                </>
              ) : (
                "Analysis time unavailable."
              )}
            </p>
            <p>
              The sample selects active discussion branches and includes available parent comments.
              It may omit parts of the full thread.
              {coverage?.comments_truncated && (
                <>
                  {" "}
                  The analysis included {coverage.included_comments} of {coverage.stored_comments}{" "}
                  usable stored comments because of the input limit.
                </>
              )}{" "}
              Selected themes do not measure community opinion or how common a view is.
            </p>
          </div>
        </div>
      </div>
      {analysis.status === "no_comments" ? (
        <p>No usable comments were available for this analysis, so no themes could be selected.</p>
      ) : (
        <>
          {analysis.topics.length > 0 ? (
            <DiscussionTopics>
              {analysis.topics.map((topic, topicIndex) => (
                <div
                  className="analysis-theme"
                  id={`discussion-topic-${topic.key}-${topicIndex}`}
                  key={`${topic.key}-${topicIndex}`}
                >
                  <section className="analysis-theme-section">
                    <h3 {...readingSection("theme_heading", topic.title, topicIndex + 1)}>
                      <span>{topic.title}</span>
                    </h3>
                    <div
                      className="analysis-theme-body"
                      {...readingSection("theme_body", topic.summary, topicIndex + 1)}
                    >
                      <p>
                        <SummaryInline text={topic.summary} />
                      </p>
                    </div>
                  </section>
                </div>
              ))}
            </DiscussionTopics>
          ) : (
            <p className="muted">No distinct themes were identified in the analyzed comments.</p>
          )}
        </>
      )}
    </div>
  );
}
