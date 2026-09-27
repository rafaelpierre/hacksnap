import { ArrowUpRight, ChevronDown, ThumbsDown, ThumbsUp } from "lucide-react";
import type {
  CriticalCommentHighlight,
  SupportiveCommentHighlight,
  DiscussionAnalysis as Analysis,
  DiscussionAnalysisCoverage,
} from "../lib/discussion-analysis";

const stanceLabels = {
  disagrees: "Disagrees",
  qualified_disagreement: "Disagrees with qualifications",
  agrees: "Agrees",
  qualified_agreement: "Agrees with reservations",
};

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

function HighlightGroup({
  kind,
  highlights,
  claims,
}: {
  kind: "critical" | "supportive";
  highlights: (CriticalCommentHighlight | SupportiveCommentHighlight)[];
  claims: Analysis["reference_claims"];
}) {
  const title = kind === "critical" ? "Most critical" : "Most supportive";
  const Icon = kind === "critical" ? ThumbsDown : ThumbsUp;
  return (
    <section className="analysis-group" aria-labelledby={`most-${kind}`}>
      <h3 id={`most-${kind}`} className="analysis-group-heading">
        <Icon className="analysis-group-icon" aria-hidden="true" />
        <span>{title}</span>
      </h3>
      {highlights.length ? (
        <ul className="analysis-highlights">
          {highlights.map((highlight) => {
            const claim = claims.find((item) => item.id === highlight.claim_id);
            return (
              <li key={highlight.comment_id}>
                <p className="analysis-stance">{stanceLabels[highlight.stance]}</p>
                <p className="analysis-paraphrase">{highlight.paraphrase}</p>
                <p>{highlight.explanation}</p>
                {claim && (
                  <p className="analysis-claim">
                    <strong>
                      Claim addressed ({claim.source === "article" ? "article" : "HN post"}):
                    </strong>{" "}
                    {claim.text}
                  </p>
                )}
                <SourceComment id={highlight.comment_id} context={highlight.paraphrase} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">
          No clear {kind} examples in the analyzed comments. Other views may exist elsewhere in the
          thread.
        </p>
      )}
    </section>
  );
}

export function DiscussionAnalysis({
  analysis,
  coverage,
  analyzedAt,
  hnURL,
}: {
  analysis: Analysis;
  coverage?: DiscussionAnalysisCoverage | null;
  analyzedAt?: string | null;
  hnURL: string;
}) {
  const date = analyzedAt ? new Date(analyzedAt) : null;
  const validDate = date && Number.isFinite(date.getTime()) ? date : null;
  return (
    <div className="discussion-analysis">
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
          The sample selects active discussion branches and includes available parent comments. It
          may omit parts of the full thread.
          {coverage?.comments_truncated && (
            <>
              {" "}
              The analysis included {coverage.included_comments} of {coverage.stored_comments}{" "}
              usable stored comments because of the input limit.
            </>
          )}{" "}
          Selected examples and themes do not measure community opinion or how common a view is.
        </p>
      </div>
      {analysis.status === "no_comments" ? (
        <p>
          No usable comments were available for this analysis. Themes and stance examples could not
          be selected.
        </p>
      ) : (
        <>
          {analysis.topics.length > 0 && (
            <section className="analysis-themes" aria-labelledby="discussion-themes-heading">
              <h3 id="discussion-themes-heading">Discussion themes</h3>
              {analysis.topics.map((topic) => (
                <details className="analysis-theme" key={topic.key}>
                  <summary>
                    <span>{topic.title}</span>
                    <ChevronDown className="analysis-theme-chevron" aria-hidden="true" />
                  </summary>
                  <div className="analysis-theme-body">
                    <p>{topic.summary}</p>
                    <ul
                      className="analysis-sources"
                      aria-label={`Source comments for ${topic.title}`}
                    >
                      {topic.comment_ids.map((id) => (
                        <li key={id}>
                          <SourceComment id={id} context={topic.title} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </section>
          )}
          {analysis.status === "insufficient_context" ? (
            <p>
              The original source was unavailable or did not contain a clear claim to assess.
              Critical and supportive examples could not be identified against a source claim.
            </p>
          ) : (
            <>
              <p className="analysis-selection">
                Among the comments analyzed. Examples are selected for explicit stance and
                explanation; their inclusion does not establish that an argument is correct. Comment
                text below is paraphrased.
              </p>
              <div className="analysis-groups">
                <HighlightGroup
                  kind="critical"
                  highlights={analysis.critical_comments}
                  claims={analysis.reference_claims}
                />
                <HighlightGroup
                  kind="supportive"
                  highlights={analysis.supportive_comments}
                  claims={analysis.reference_claims}
                />
              </div>
            </>
          )}
        </>
      )}
      <a className="analysis-source" href={hnURL}>
        Read the full HN discussion <ArrowUpRight className="inline-icon" aria-hidden="true" />
      </a>
    </div>
  );
}
