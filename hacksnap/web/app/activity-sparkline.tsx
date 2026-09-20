"use client";

import { useId, useState, type PointerEvent } from "react";
import { activityChart, activityIntervals, activityChange, formatRate, type ActivityObservation } from "../lib/activity-history";

const time = (value: number) => new Date(value).toLocaleString("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

export function ActivitySparkline({history, title, asOf}: {history: ActivityObservation[]; title: string; asOf: string}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const intervals = activityIntervals(history, asOf);
  const {points, path, baseline, min, max} = activityChart(intervals, asOf);
  const last = points.at(-1);
  const change = activityChange(intervals);
  const changeLabel = change === null ? "Not enough history to measure a change in activity"
    : `${formatRate(change)} points/hour change from the first to the latest measured rate`;
  const selected = points[Math.min(active ?? points.length - 1, points.length - 1)];
  const detail = selected ? `${formatRate(selected.rate)} points/hour, average from ${time(selected.start)} to ${time(selected.end)} UTC.` : "Collecting history. At least two observations in the past 24 hours are needed.";
  const description = `${title}. Point activity over the past 24 hours. ${changeLabel}. ${detail} Each point is an interval average plotted at its ending observation. Connecting lines are visual guides, not measured intermediate rates. Scale ${formatRate(min)} to ${formatRate(max)} points/hour, scaled per story. The flat lead-in extends the first available value to the left edge; earlier activity was not measured. Use left and right arrow keys to explore.`;
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
  return <figure className="activity-history" aria-label={`Point activity for ${title}`}>
    <figcaption>Hotness <span>24h</span></figcaption>
    {last && selected ? <>
      <div className="activity-rate" aria-label={changeLabel} title={changeLabel}>{change === null ? "—" : formatRate(change)}</div>
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
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient></defs>
        <path className="sparkline-baseline" d={`M6 ${baseline}H154`} />
        <path fill={`url(#${gradientId})`} d={`${path} L${last.x},${baseline} L6,${baseline} Z`} />
        <path className="sparkline-path" d={path} />
        <circle className="sparkline-endpoint-halo" cx={last.x} cy={last.y} r="6" />
        <circle className="sparkline-endpoint" cx={last.x} cy={last.y} r="3" />
        {active !== null && <circle className="sparkline-endpoint" cx={selected.x} cy={selected.y} r="3" />}
      </svg>
      {active !== null && <div className="sparkline-tooltip"><strong>{change === null ? "Change unavailable: one measured rate" : `${formatRate(change)} points/hour change`}</strong><br />First → latest measured rate<br /><br />{formatRate(selected.rate)} points/hour at selected point<br />{time(selected.start)}–{time(selected.end)} UTC<br />Average between observations{selected === points[0] && <><br />Flat lead-in uses this first value; earlier activity is unknown.</>}<br />Scale: {formatRate(min)} to {formatRate(max)} pts/h</div>}
    </> : <div className="sparkline-empty">Collecting history<span>Needs two observations in 24h</span></div>}
  </figure>;
}
