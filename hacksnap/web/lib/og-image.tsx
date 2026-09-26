import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogImageSize = { width: 1200, height: 630 };

// Bundle local, static TTFs: the OG renderer cannot use the site's variable WOFF2s.
// Cache asset reads across requests; the fixed random grain keeps previews stable.
let assets: Promise<[Buffer, Buffer, Buffer]> | undefined;
function loadAssets() {
  return assets ??= Promise.all([
    readFile(join(process.cwd(), "app/fonts/bricolage-grotesque-og-600.ttf")),
    readFile(join(process.cwd(), "app/fonts/source-sans-3-og-400.ttf")),
    readFile(join(process.cwd(), "lib/assets/og-grain.png")),
  ]).catch((error) => {
    assets = undefined;
    throw error;
  });
}

/** Shared artwork for home and story previews, with no remote asset requests. */
export async function ogImage({title = "AI on Hacker News", source}: {title?: string; source?: string} = {}) {
  const [heading, body, grain] = await loadAssets();
  const cleanTitle = title.replace(/\s+/g, " ").trim() || "AI on Hacker News";
  const characters = Array.from(cleanTitle);
  const headline = characters.length > 180 ? characters.slice(0, 177).join("").trimEnd() + "…" : cleanTitle;
  const fontSize = headline.length > 120 ? 54 : headline.length > 75 ? 64 : 80;

  return new ImageResponse(
    <div style={{width: "100%", height: "100%", position: "relative", display: "flex", background: "#111314", color: "#e6e8e7", fontFamily: "Source Sans 3"}}>
      <img alt="" src={`data:image/png;base64,${grain.toString("base64")}`} width={1200} height={630} style={{position: "absolute", top: 0, left: 0, width: "100%", height: "100%"}} />
      <div style={{position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(5, 5, 5, 0.2784)"}} />
      <div style={{position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "48px 64px"}}>
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <div style={{display: "flex", alignItems: "center", gap: 14, fontFamily: "Bricolage Grotesque", fontSize: 32, fontWeight: 600, letterSpacing: -1}}>
            <span style={{color: "#efaa7b", fontSize: 40}}>h/</span><span>hacksnap</span>
          </div>
          <div style={{display: "flex", color: "#9a9fa0", fontSize: 18, letterSpacing: 2}}>AI / HACKER NEWS</div>
        </div>
        <div style={{display: "flex", flex: 1, minHeight: 0, flexDirection: "column", justifyContent: "center", padding: "28px 0"}}>
          <div style={{display: "flex", alignItems: "center", gap: 12, color: "#efaa7b", fontSize: 22, marginBottom: 18}}>
            <span style={{width: 24, height: 2, background: "#efaa7b"}} />
            <span>{source ? source.slice(0, 70) : "Your AI reading list"}</span>
          </div>
          <div style={{display: "block", fontFamily: "Bricolage Grotesque", fontSize, fontWeight: 600, letterSpacing: -2, lineHeight: 1.1, wordBreak: "break-word", lineClamp: 4, overflow: "hidden", maxHeight: fontSize * 1.1 * 4}}>{headline}</div>
          {!source && <div style={{display: "flex", fontSize: 28, color: "#9a9fa0", marginTop: 22}}>The articles and the arguments worth reading.</div>}
        </div>
        <div style={{display: "flex", flexShrink: 0, justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #383c3d", paddingTop: 22, fontSize: 22}}>
          <span style={{color: "#9a9fa0"}}>Article briefs + discussion highlights</span>
          <span style={{color: "#efaa7b"}}>hacksnap.live</span>
        </div>
      </div>
    </div>,
    {
      ...ogImageSize,
      fonts: [
        {name: "Bricolage Grotesque", data: heading, weight: 600, style: "normal"},
        {name: "Source Sans 3", data: body, weight: 400, style: "normal"},
      ],
    },
  );
}
