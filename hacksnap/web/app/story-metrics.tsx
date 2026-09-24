import type { Story } from "../lib/data";
import { rankChart } from "../lib/rank-history";
import { RANKING_METHOD, storyMetrics } from "../lib/story-metrics";

const observedTime = (value: string) => new Date(value).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
}) + " UTC";

// Server-rendered text and SVG remain readable without JavaScript or tooltips.
export function StoryMetrics({story}: {story: Story}) {
  const metrics = storyMetrics(story);
  const ranking = story.ranking_metrics;
  const history = ranking?.history ?? [];
  const chart = rankChart(history.map(point => ({at: Date.parse(point.observed_at), rank: point.rank})));
  const first = history[0];
  const last = history.at(-1);
  return <section className="story-metrics" aria-labelledby="story-metrics-heading">
    <h2 id="story-metrics-heading">Skept-o-meter &amp; Hotness</h2>
    <dl className="story-metrics-grid">
      <div>
        <dt>Skepticism</dt><dd>{metrics.skepticism}
        <div className={`story-metrics-meter skepticism-${metrics.position === null ? "pending" : metrics.skepticism.toLowerCase()}`} aria-hidden="true">
          <span className="skepticism-rail">{metrics.position !== null && <span className="skepticism-marker" style={{left: `${metrics.position}%`}} />}</span>
        </div>
        <p>{metrics.skepticismNote}</p></dd>
      </div>
      <div><dt>Summary coverage</dt><dd>{metrics.comments}
        <p>{story.summary ? `Sampled from ${story.summary.source_coverage.stored_comments.toLocaleString("en-GB")} usable stored comments.` : "Comment coverage will appear after analysis."}</p></dd>
      </div>
      <div><dt>Peak observed Hacksnap rank</dt><dd>{metrics.peak}<p>Across all retained ranking history.</p></dd></div>
      <div><dt>Time in Hacksnap Top 10</dt><dd>{metrics.topTen}<p>Estimated between recorded observations.</p></dd></div>
    </dl>
    {first && last ? <figure className="story-rank-chart">
      <figcaption>Hotness · Hacksnap ranking over time
        <span>{history.length < (ranking?.observation_count ?? 0) ? `Latest ${history.length} of ${ranking?.observation_count.toLocaleString("en-GB")}` : history.length.toLocaleString("en-GB")} recorded {history.length === 1 ? "observation" : "observations"} · Higher is better</span>
      </figcaption>
      <div className="story-rank-plot">
        <div className="story-rank-scale" aria-hidden="true"><span>#1</span><span>#{chart.max.toLocaleString("en-GB")}</span></div>
        <svg viewBox="0 0 160 60" preserveAspectRatio="none" role="img" aria-label={`Recorded Hacksnap ranks: #${first.rank} on ${observedTime(first.observed_at)} to #${last.rank} on ${observedTime(last.observed_at)}. Lines connect observations; intermediate ranks are unknown.`}>
          <path className="sparkline-baseline" d="M6 6H154 M6 54H154" />
          <path className="sparkline-path" d={chart.path} vectorEffect="non-scaling-stroke" />
          {chart.points.map(point => <circle key={point.at} className="sparkline-endpoint" cx={point.x} cy={point.y} r="1" vectorEffect="non-scaling-stroke"><title>{`#${point.rank} · ${observedTime(new Date(point.at).toISOString())}`}</title></circle>)}
        </svg>
      </div>
      <div className="story-rank-dates"><time dateTime={first.observed_at}>{observedTime(first.observed_at)}</time>{history.length > 1 && <time dateTime={last.observed_at}>{observedTime(last.observed_at)}</time>}</div>
      <p>Latest recorded rank: <strong>#{last.rank.toLocaleString("en-GB")}</strong>{history.length === 1 ? ". One observation does not establish a trend." : "."}</p>
    </figure> : <p className="story-metrics-empty">No ranking history recorded yet. Hotness will appear after a ranking observation is saved.</p>}
    <p className="story-metrics-method">{RANKING_METHOD}</p>
    {ranking?.first_observed_at && ranking.last_observed_at && <p className="story-metrics-method">Tracking since <time dateTime={ranking.first_observed_at}>{observedTime(ranking.first_observed_at)}</time> · Last recorded <time dateTime={ranking.last_observed_at}>{observedTime(ranking.last_observed_at)}</time></p>}
  </section>;
}
