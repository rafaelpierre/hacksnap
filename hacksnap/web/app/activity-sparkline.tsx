"use client";

import { useId, useState, type PointerEvent } from "react";
import { rankChart, rankSamples, rankChange, formatRankChange, formatRankDuration, type RankObservation } from "../lib/rank-history";

const time = (value: number) => new Date(value).toLocaleString("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

export function ActivitySparkline({history, title, asOf, currentRank}: {history: RankObservation[]; title: string; asOf: string; currentRank?: string}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const samples = rankSamples(history, asOf, currentRank);
  const {points, path, baseline, max, duration} = rankChart(samples);
  const last = points.at(-1);
  const change = rankChange(samples);
  const changeLabel = change === null ? "Not enough history to measure a change in rank"
    : `${formatRankChange(change)} places changed from the first to the latest observed rank`;
  const trend = change === null || change === 0 ? "steady" : change > 0 ? "up" : "down";
  const journey = change === null ? "One observed position" : change === 0 ? "No net change" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} ${Math.abs(change) === 1 ? "place" : "places"}`;
  const selected = points[Math.min(active ?? points.length - 1, points.length - 1)];
  const detail = selected ? `Rank #${selected.rank} at ${time(selected.at)} UTC.` : "Collecting history.";
  const description = `${title}. Hacksnap ranking across ${formatRankDuration(duration)} of available history within the past 24 hours. ${changeLabel}. ${detail} Higher on the chart means a better position. Curves are visual guides connecting observed positions; movement between observations is unknown. Scale #1 to #${max}. Use left and right arrow keys to explore.`;
  function selectAtPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 160;
    let nearest = 0;
    let distance = Infinity;
    points.forEach((point, i) => {
      const d = Math.abs(point.x - x);
      if (d < distance) { distance = d; nearest = i; }
    });
    setActive(nearest);
  }
  return <figure className="activity-history" data-trend={trend} aria-label={`Ranking movement for ${title}`}>
    <figcaption>Hotness <span title="Span of available observations within the past 24 hours">{formatRankDuration(duration)}</span></figcaption>
    {last && selected ? <>
      <svg viewBox="0 0 160 60" role="img" tabIndex={0} aria-label={description}
        onFocus={() => setActive(points.length - 1)} onBlur={() => setActive(null)}
        onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }}
        onPointerDown={event => { event.currentTarget.focus(); selectAtPointer(event); }} onPointerMove={selectAtPointer}
        onKeyDown={event => {
          if (event.key === "Escape") { setActive(null); return; }
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setActive(index => event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 :
            Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
        }}>
        <title>{description}</title>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sparkline-color)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--sparkline-color)" stopOpacity="0" />
        </linearGradient></defs>
        <path className="sparkline-baseline" d={`M6 ${baseline}H154`} />
        <path fill={`url(#${gradientId})`} d={`${path} L${last.x},${baseline} L${points[0].x},${baseline} Z`} />
        <path className="sparkline-path" d={path} />
        <circle className="sparkline-endpoint-halo" cx={last.x} cy={last.y} r="6" />
        <circle className="sparkline-endpoint" cx={last.x} cy={last.y} r="3" />
        {active !== null && <circle className="sparkline-endpoint" cx={selected.x} cy={selected.y} r="3" />}
      </svg>
      {active !== null && <div className="sparkline-tooltip"><strong>#{points[0].rank} → #{last.rank} · {journey}</strong><br />{time(points[0].at)}–{time(last.at)} UTC<br /><br />Rank #{selected.rank}<br />{time(selected.at)} UTC<br />Hacksnap ranking · higher is better<br />Scale: #1 to #{max}<br />Movement between observations is unknown.</div>}
    </> : <div className="sparkline-empty">Collecting history</div>}
  </figure>;
}
