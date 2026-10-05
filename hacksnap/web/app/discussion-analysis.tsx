import styles from "./discussion-analysis.module.css";
import { ArrowUpRight, ChevronDown, Info, ListTree, X } from "lucide-react";
import type {
  DiscussionAnalysis as Analysis,
  DiscussionAnalysisCoverage,
} from "../lib/discussion-analysis";

function SourceComment({ id, context }: { id: number; context: string }) {
  return (
    <a
      className="analysis-source"
      href={`https://news.ycombinator.com/item?id=${id}`}
      aria-label={`Read HN comment ${id}: ${context}`}
    >
      HN comment {id} <ArrowUpRight className="inline-icon" aria-hidden="true" />
    </a>
  );
}

function SourceComments({
  id,
  context,
  commentIds,
}: {
  id: string;
  context: string;
  commentIds: number[];
}) {
  return (
    <>
      <button
        type="button"
        className="analysis-source-info"
        popoverTarget={id}
        aria-label={`Source comments for ${context}`}
      >
        <Info size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div
        id={id}
        className="analysis-source-popup"
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
      >
        <div className="analysis-source-header">
          <p id={`${id}-title`}>Source comments</p>
          <button
            type="button"
            className="analysis-source-close"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="Close source comments"
            autoFocus
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <ul className="analysis-sources" aria-label={`Source comments for ${context}`}>
          {commentIds.map((commentId) => (
            <li key={commentId}>
              <SourceComment id={commentId} context={context} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

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
      <div className="discussion-heading analysis-heading">
        <h2 id="discussion-themes-heading" className="discussion-title">
          <ListTree className="discussion-title-icon" aria-hidden="true" />
          <span>Discussion themes</span>
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
            <div className="analysis-themes">
              {analysis.topics.map((topic, topicIndex) => (
                <div className="analysis-theme" key={`${topic.key}-${topicIndex}`}>
                  <details className="analysis-theme-details">
                    <summary>
                      <span>{topic.title}</span>
                      <ChevronDown className="analysis-theme-chevron" aria-hidden="true" />
                    </summary>
                    <div className="analysis-theme-body">
                      <p>{topic.summary}</p>
                    </div>
                  </details>
                  <SourceComments
                    id={`theme-sources-${topic.key}-${topicIndex}`}
                    context={topic.title}
                    commentIds={topic.comment_ids}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No distinct themes were identified in the analyzed comments.</p>
          )}
        </>
      )}
    </div>
  );
}
