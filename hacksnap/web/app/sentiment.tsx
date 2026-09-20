const labels = {"-1": "Skeptical", "0": "Neutral", "1": "Excited"} as const;

export function Sentiment({value, noComments = false}: {value: -1 | 0 | 1 | null; noComments?: boolean}) {
  const label = value === null ? (noComments ? "No comments" : "Pending") : labels[value];
  const description = value === null
    ? (noComments ? "No usable comments available to estimate sentiment." : "Sentiment will appear after the summary refreshes.")
    : `${label}. Estimated from sampled thread comments; mixed or inconclusive reactions are Neutral. This is not a community vote.`;
  return <figure className={`sentiment sentiment-${value === null ? "pending" : label.toLowerCase()}`} title={`Sentiment: ${label}. ${description}`} tabIndex={0} aria-label={`Sentiment: ${label}. ${description}`}>
    <div className="sentiment-scale" aria-hidden="true">
      {([-1, 0, 1] as const).map(point => <span key={point} className={value === point ? "selected" : ""} />)}
    </div>
  </figure>;
}
