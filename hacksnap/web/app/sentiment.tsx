const labels = {"-1": "Skeptical", "0": "Neutral", "1": "Excited"} as const;

export function Sentiment({value, noComments = false}: {value: -1 | 0 | 1 | null; noComments?: boolean}) {
  const label = value === null ? (noComments ? "No comments" : "Pending") : labels[value];
  const score = value === 1 ? "+1" : value === -1 ? "−1" : "0";
  const description = value === null
    ? (noComments ? "No usable comments available to estimate sentiment." : "Sentiment will appear after the summary refreshes.")
    : `${label} (${score}). Estimated from sampled thread comments; mixed or inconclusive reactions are Neutral. This is not a community vote.`;
  return <figure className={`sentiment sentiment-${value === null ? "pending" : label.toLowerCase()}`} title={description}>
    <figcaption>Sentiment</figcaption>
    <div className="sentiment-label">{value !== null && <span>{score} </span>}{label}</div>
    <div className="sentiment-scale" role="img" aria-label={description}>
      {([-1, 0, 1] as const).map(point => <span key={point} className={value === point ? "selected" : ""} />)}
    </div>
  </figure>;
}
