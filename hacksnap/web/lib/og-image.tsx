import { ImageResponse } from "next/og";

export const ogImageSize = { width: 1200, height: 630 };

/** Shared, self-contained artwork: no remote images, fonts, or model calls. */
export function ogImage({title = "AI on Hacker News", source}: {title?: string; source?: string} = {}) {
  const cleanTitle = title.replace(/\s+/g, " ").trim() || "AI on Hacker News";
  const characters = Array.from(cleanTitle);
  const headline = characters.length > 180 ? characters.slice(0, 177).join("").trimEnd() + "…" : cleanTitle;
  const fontSize = headline.length > 120 ? 52 : headline.length > 75 ? 62 : 76;

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
        {!source && <div style={{display: "flex", fontSize: 28, color: "#9a9fa0", marginTop: 24}}>The articles and the arguments worth reading.</div>}
      </div>
      <div style={{display: "flex", justifyContent: "space-between", borderTop: "1px solid #2b3032", paddingTop: 24, fontSize: 22}}>
        <span style={{color: "#9a9fa0"}}>Article briefs + discussion highlights</span>
        <span style={{color: "#efaa7b"}}>hacksnap.live</span>
      </div>
    </div>,
    ogImageSize,
  );
}
