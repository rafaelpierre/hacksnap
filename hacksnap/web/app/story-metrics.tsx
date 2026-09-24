import type { Story } from "../lib/data";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { ActivitySparkline } from "./activity-sparkline";
import { storyMetrics } from "../lib/story-metrics";

const observedTime = (value: string) => new Date(value).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
}) + " UTC";

function MetricInfo({label, children}: {label: string; children: ReactNode}) {
  return <details className="metric-info">
    <summary aria-label={`About ${label}`}><Info size={14} strokeWidth={1.5} aria-hidden="true" /></summary>
    <div className="metric-info-content">{children}</div>
  </details>;
}

// Values and chart are always visible; native disclosures also work without JS.
export function StoryMetrics({story}: {story: Story}) {
  const metrics = storyMetrics(story);
  const ranking = story.ranking_metrics;
  const history = ranking?.history ?? [];
  const first = history[0];
  const last = history.at(-1);
  return <section className="story-metrics" aria-labelledby="story-metrics-heading">
    <h2 id="story-metrics-heading">Skept-o-meter &amp; Hotness</h2>
    <dl className="story-metrics-grid">
      <div>
        <dt>Skept-o-meter</dt><dd>{metrics.skepticism}
        <div className={`story-metrics-meter skepticism-${metrics.position === null ? "pending" : metrics.skepticism.toLowerCase()}`} aria-hidden="true">
          <span className="skepticism-rail">{metrics.position !== null && <span className="skepticism-marker" style={{left: `${metrics.position}%`}} />}</span>
        </div>
        <MetricInfo label="Skept-o-meter"><p>{metrics.skepticismNote} Further right means more skeptical. Mixed, neutral and positive reactions are grouped as Low.</p></MetricInfo></dd>
      </div>
      <div><dt>Summary coverage</dt><dd>{metrics.comments}
        <MetricInfo label="summary coverage"><p>{story.summary ? `Sampled from ${story.summary.source_coverage.stored_comments.toLocaleString("en-GB")} usable stored comments. This count covers the summary; skepticism may use a smaller sample.` : "Comment coverage will appear after analysis."}</p></MetricInfo></dd>
      </div>
      <div><dt>Peak rank</dt><dd>{metrics.peak}<MetricInfo label="peak rank"><p>The best recorded position across all retained Hacksnap ranking history.</p>
        {ranking?.first_observed_at && <p>Tracking since <time dateTime={ranking.first_observed_at}>{observedTime(ranking.first_observed_at)}</time>.</p>}
      </MetricInfo></dd></div>
      <div><dt>Time in Top 10</dt><dd>{metrics.topTen}<MetricInfo label="time in the Top 10"><p>Estimated time in Hacksnap’s Top 10, holding each recorded rank until the next observation. Gaps over 13 hours and time after the last observation are excluded. Movement between observations is unknown.</p></MetricInfo></dd></div>
    </dl>
    {first && last ? <div className="story-rank-chart">
      <ActivitySparkline history={history} title={story.title} asOf={story.observed_at ?? last.observed_at} scope="recorded" />
      <p className="story-rank-observations">{history.length < (ranking?.observation_count ?? 0) ? `Latest ${history.length} of ${ranking?.observation_count.toLocaleString("en-GB")}` : history.length.toLocaleString("en-GB")} recorded {history.length === 1 ? "observation" : "observations"}</p>
      <div className="story-rank-dates"><time dateTime={first.observed_at}>{observedTime(first.observed_at)}</time>{history.length > 1 && <time dateTime={last.observed_at}>{observedTime(last.observed_at)}</time>}</div>
      <p>Latest recorded rank: <strong>#{last.rank.toLocaleString("en-GB")}</strong></p>
      <MetricInfo label="Hotness"><p>Hacksnap ranking over time: recent stories come first, then each group is ordered by points. Higher on the chart means a better position. The chart shows up to the latest 168 recorded ranks; curves connect observations and movement between them is unknown.</p>{history.length === 1 && <p>One observation does not establish a trend.</p>}</MetricInfo>
    </div> : <p className="story-metrics-empty">No ranking history recorded yet.</p>}
  </section>;
}
