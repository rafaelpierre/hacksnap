import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { briefExcerpt } from "./brief";

export const ogImageSize = { width: 1200, height: 630 };

// Bundle local, static TTFs: the OG renderer cannot use the site's variable WOFF2s.
// Cache the same brand and summary typefaces used by the frontend.
let assets: Promise<[Buffer, Buffer]> | undefined;
function loadAssets() {
  return (assets ??= Promise.all([
    readFile(join(process.cwd(), "app/fonts/bricolage-grotesque-og-600.ttf")),
    readFile(join(process.cwd(), "app/fonts/source-sans-3-og-400.ttf")),
  ]).catch((error) => {
    assets = undefined;
    throw error;
  }));
}

/** Shared artwork for home and story previews, with no remote asset requests. */
export async function ogImage({
  title = "AI on Hacker News",
  source,
  takeaway,
}: { title?: string; source?: string; takeaway?: string | null } = {}) {
  const [heading, body] = await loadAssets();
  const cleanTitle = title.replace(/\s+/g, " ").trim() || "AI on Hacker News";
  const characters = Array.from(cleanTitle);
  const headline =
    characters.length > 180 ? characters.slice(0, 177).join("").trimEnd() + "…" : cleanTitle;
  const snippet = briefExcerpt(takeaway);
  const fontSize = snippet
    ? headline.length > 120
      ? 44
      : headline.length > 75
        ? 54
        : 68
    : headline.length > 120
      ? 54
      : headline.length > 75
        ? 64
        : 80;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        display: "flex",
        padding: 32,
        background: "#f4f4f5",
        color: "#24242b",
        fontFamily: "Source Sans 3",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "36px 40px",
          background: "#ffffff",
          border: "1px solid #dddde3",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: "Bricolage Grotesque",
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: -1,
            }}
          >
            <svg width="52" height="52" viewBox="0 0 96 96" aria-hidden="true">
              <rect width="96" height="96" fill="#24242b" />
              <path
                fill="#ffffff"
                transform="translate(-5 0)"
                d="M18 22h11v22c3-4 7-6 12-6 10 0 15 6 15 17v21H45V57c0-6-2-9-7-9-5 0-9 4-9 10v18H18zm59-2h11L67 80H56z"
              />
            </svg>
            <span>hacksnap</span>
          </div>
          <div style={{ display: "flex", color: "#62626e", fontSize: 20 }}>
            AI stories & discussions
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            flexDirection: "column",
            justifyContent: "center",
            padding: "24px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: "#0000ff",
              fontSize: 20,
              marginBottom: 14,
            }}
          >
            <span>{source ? source.slice(0, 70) : "Your AI reading list"}</span>
          </div>
          <div
            style={{
              display: "block",
              fontFamily: "Bricolage Grotesque",
              fontSize,
              fontWeight: 600,
              letterSpacing: -0.02 * fontSize,
              lineHeight: 1.1,
              wordBreak: "break-word",
              lineClamp: 3,
              overflow: "hidden",
              maxHeight: fontSize * 1.1 * 3,
            }}
          >
            {headline}
          </div>
          {snippet ? (
            <div
              style={{
                display: "block",
                flexShrink: 0,
                fontFamily: "Source Sans 3",
                fontSize: 26,
                lineHeight: 1.25,
                color: "#474751",
                marginTop: 16,
                wordBreak: "break-word",
                lineClamp: 3,
                overflow: "hidden",
                maxHeight: 26 * 1.25 * 3,
              }}
            >
              {snippet}
            </div>
          ) : (
            !source && (
              <div style={{ display: "flex", fontSize: 28, color: "#474751", marginTop: 22 }}>
                The articles and the arguments worth reading.
              </div>
            )
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #dddde3",
            paddingTop: 20,
            fontSize: 20,
          }}
        >
          <span style={{ color: "#62626e" }}>Article briefs + discussion highlights</span>
          <span style={{ color: "#0000ff" }}>hacksnap.live</span>
        </div>
      </div>
    </div>,
    {
      ...ogImageSize,
      fonts: [
        { name: "Bricolage Grotesque", data: heading, weight: 600, style: "normal" },
        { name: "Source Sans 3", data: body, weight: 400, style: "normal" },
      ],
    },
  );
}
