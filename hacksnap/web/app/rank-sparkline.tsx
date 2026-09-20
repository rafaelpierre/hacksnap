"use client";

import { useId, useState, type PointerEvent } from "react";
import { chartPoints, rankPath, type RankObservation } from "../lib/rank-history";

const time = (value: string) => new Date(value).toLocaleString("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

export function RankSparkline({ history, title, maxRank }: {history: RankObservation[]; title: string; maxRank: number}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const points = chartPoints(history, maxRank);
  const line = rankPath(points);
  const selected = points[Math.min(active ?? points.length - 1, points.length - 1)];
  const first = points[0];
  const last = points.at(-1);
  function selectAtPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 160;
    let nearest = 0;
    points.forEach((point, i) => { if (Math.abs(point.x - x) < Math.abs(points[nearest].x - x)) nearest = i; });
    setActive(nearest);
  }
  const description = !first || !last ? "No ranking history yet" : points.length === 1
    ? `${last.current ? "Current rank" : "One observation: rank"} #${last.rank}, ${time(last.observed_at)} UTC. No earlier history.`
    : `Rank #${first.rank} to #${last.rank}, ${time(first.observed_at)} to ${time(last.observed_at)} UTC. ${last.current ? "Endpoint is the current rank at page refresh. " : ""}Steps hold the last observed rank; changes between observations are unknown. Better positions appear higher. Shared scale #1 to #${maxRank}. Use left and right arrow keys to explore.`;

  return <figure className="rank-history" aria-label={`Hacksnap ranking history for ${title}`}>
    <figcaption>Rank history{last && ` · #${last.rank}`}</figcaption>
    {selected ? <>
      <svg viewBox="0 0 160 60" role="img" tabIndex={0}
        aria-label={active === null ? description : `${selected.current ? "Current rank at page refresh" : "Recorded rank"} #${selected.rank}, ${time(selected.observed_at)} UTC. Use arrow keys to explore.`}
        onFocus={() => setActive(points.length - 1)} onBlur={() => setActive(null)}
        onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }}
        onPointerDown={event => { event.currentTarget.focus(); selectAtPointer(event); }}
        onPointerMove={selectAtPointer}
        onKeyDown={event => {
          if (event.key === "Escape") { setActive(null); return; }
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setActive(index => event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 :
            Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
        }}>
        <title>{description}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path className="sparkline-baseline" d="M6 58H154" />
        {points.length > 1 && <>
          <path fill={`url(#${gradientId})`} d={`${line} L${last!.x},58 L${first.x},58 Z`} />
          <path className="sparkline-path" d={line} />
        </>}
        <circle className="sparkline-endpoint-halo" cx={last!.x} cy={last!.y} r="6" />
        <circle className="sparkline-endpoint" cx={last!.x} cy={last!.y} r="3" />
        {active !== null && <circle className="sparkline-endpoint" cx={selected.x} cy={selected.y} r="3" />}
      </svg>
      {active !== null && <div className="sparkline-tooltip"><strong>{selected.current ? "Current rank" : "Recorded rank"} #{selected.rank.toLocaleString("en-GB")}</strong><br />{time(selected.observed_at)} UTC{selected.current && <><br />At page refresh</>}</div>}
    </> : <div className="sparkline-empty">Awaiting history</div>}
  </figure>;
}
