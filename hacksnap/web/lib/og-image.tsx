import { ImageResponse } from "next/og";
import { skepticismDisplay } from "./sentiment";
import { rankChart, rankSamples, formatRankDuration, type RankObservation } from "./rank-history";

export const ogImageSize = { width: 1200, height: 630 };

/** Shared, self-contained artwork: no remote images, fonts, or model calls. */
type Indicators = {
  sentiment: -1 | 0 | 1 | null;
  noComments: boolean;
  history: RankObservation[];
  asOf: string;
  currentRank?: string;
};

export function ogImage({title = "AI on Hacker News", source, indicators}: {title?: string; source?: string; indicators?: Indicators} = {}) {
  const cleanTitle = title.replace(/\s+/g, " ").trim() || "AI on Hacker News";
  const characters = Array.from(cleanTitle);
  const headline = characters.length > 180 ? characters.slice(0, 177).join("").trimEnd() + "…" : cleanTitle;
  const fontSize = indicators ? (headline.length > 120 ? 44 : headline.length > 75 ? 52 : 64)
    : headline.length > 120 ? 52 : headline.length > 75 ? 62 : 76;
  const skepticism = indicators ? skepticismDisplay(indicators.sentiment, indicators.noComments) : null;
  const chart = indicators ? rankChart(rankSamples(indicators.history, indicators.asOf, indicators.currentRank)) : null;
  const last = chart?.points.at(-1);

  return new ImageResponse(
    <div style={{width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#111314", color: "#e6e8e7", padding: "48px 64px", fontFamily: "sans-serif", borderTop: "8px solid #efaa7b"}}>
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        <div style={{display: "flex", alignItems: "center", gap: 16, fontSize: 32, fontWeight: 700, letterSpacing: -1}}>
          <span style={{color: "#efaa7b", fontSize: 42}}>h/</span><span>hacksnap</span>
        </div>
        <div style={{display: "flex", color: "#9a9fa0", fontSize: 22}}>AI / HACKER NEWS</div>
      </div>
      <div style={{display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", padding: "24px 0"}}>
        {source && <div style={{display: "flex", color: "#efaa7b", fontSize: 22, marginBottom: 18}}>{source.slice(0, 70)}</div>}
        <div style={{display: "block", fontSize, fontWeight: 700, letterSpacing: -2, lineHeight: 1.12, wordBreak: "break-word", lineClamp: 4, overflow: "hidden", maxHeight: fontSize * 1.12 * 4}}>{headline}</div>
        {!source && !indicators && <div style={{display: "flex", fontSize: 28, color: "#9a9fa0", marginTop: 24}}>The articles and the arguments worth reading.</div>}
      </div>
      {skepticism && chart && <div style={{display: "flex", alignItems: "center", gap: 64, height: 116, flexShrink: 0, borderTop: "1px solid #2b3032", marginBottom: 20}}>
        <div style={{display: "flex", flexDirection: "column", width: 400, gap: 18}}>
          <div style={{display: "flex", justifyContent: "space-between", fontSize: 22}}><span>Skept-o-meter</span><span style={{color: "#efaa7b"}}>{skepticism.label}</span></div>
          <div style={{display: "flex", position: "relative", height: 8, borderRadius: 4, background: skepticism.position === null ? "#2b3032" : "linear-gradient(90deg, #9a9fa0, #d6c48f 55%, #efaa7b)"}}>
            {skepticism.position !== null && <div style={{position: "absolute", left: `${skepticism.position}%`, top: -6, width: 8, height: 20, borderRadius: 3, background: "#e6e8e7", border: "2px solid #111314"}} />}
          </div>
          <div style={{display: "flex", justifyContent: "space-between", fontSize: 16, color: "#9a9fa0"}}><span>Low</span><span>High</span></div>
        </div>
        <div style={{display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: 24}}>
          <div style={{display: "flex", flexDirection: "column", gap: 8, fontSize: 22}}><span>Hotness</span><span style={{fontSize: 16, color: "#9a9fa0"}}>{last ? `${formatRankDuration(chart.duration)} · Rank #${last.rank}` : "Collecting history"}</span></div>
          {last && <svg width="256" height="96" viewBox="0 0 160 60">
            <path d={`M6 ${chart.baseline}H154`} stroke="#2b3032" strokeWidth="1" />
            <path d={`${chart.path} L${last.x},${chart.baseline} L${chart.points[0].x},${chart.baseline} Z`} fill="#efaa7b" fillOpacity="0.1" />
            <path d={chart.path} fill="none" stroke="#efaa7b" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={last.x} cy={last.y} r="5" fill="#efaa7b" fillOpacity="0.2" />
            <circle cx={last.x} cy={last.y} r="2.5" fill="#efaa7b" />
          </svg>}
        </div>
      </div>}
      <div style={{display: "flex", justifyContent: "space-between", borderTop: "1px solid #2b3032", paddingTop: 24, fontSize: 22}}>
        <span style={{color: "#9a9fa0"}}>Article briefs + discussion highlights</span>
        <span style={{color: "#efaa7b"}}>hacksnap.live</span>
      </div>
    </div>,
    ogImageSize,
  );
}
