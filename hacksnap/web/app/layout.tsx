import type { Metadata } from "next";
import Link from "next/link";
import { Rss } from "lucide-react";
import Script from "next/script";
import localFont from "next/font/local";
import { ThemeToggle } from "./theme-toggle";
import { StickyHeader } from "./sticky-header";
import { MainNavigation } from "./main-navigation";
import { themeInitScript } from "../lib/theme";
import { analyticsBootstrap } from "../lib/analytics-bootstrap";
import "./globals.css";
import { ReaderVisit } from "./journey-analytics";

const headlines = localFont({
  src: "./fonts/bricolage-grotesque-latin-variable.woff2",
  variable: "--font-heading",
  weight: "200 800",
  style: "normal",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
});

const reading = localFont({
  src: "./fonts/source-sans-3-latin-variable.woff2",
  variable: "--font-body",
  weight: "200 900",
  style: "normal",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://hacksnap.live"),
  applicationName: "Hacksnap",
  title: { default: "Hacksnap | AI News", template: "%s | Hacksnap" },
  description:
    "AI stories from Hacker News, with article briefs and highlights from the discussion.",
  openGraph: {
    title: "Hacksnap | AI News",
    description:
      "AI stories from Hacker News, with article briefs and highlights from the discussion.",
    siteName: "Hacksnap",
    type: "website",
  },
  twitter: {
    title: "Hacksnap | AI News",
    description:
      "AI stories from Hacker News, with article briefs and highlights from the discussion.",
    card: "summary_large_image",
    images: [{ url: "/opengraph-image", alt: "Hacksnap — AI on Hacker News" }],
  },
  alternates: { types: { "application/rss+xml": "https://hacksnap.live/feed.xml" } },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="system"
      className={`${headlines.variable} ${reading.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Hacksnap",
              url: "https://hacksnap.live/",
            }),
          }}
        />
        {/* Apply the appearance preference before paint, including on cached pages. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {/* Queue visits early; fetch GA only after the reader interacts. */}
        <Script id="google-analytics" strategy="beforeInteractive">
          {analyticsBootstrap}
        </Script>
        <ReaderVisit />
        <a className="skip-link skip-main" href="#main">
          Skip to content
        </a>
        <a className="skip-link skip-browse" href="#browse-content">
          Skip to content
        </a>
        <StickyHeader>
          <div className="header-inner">
            <Link className="wordmark" href="/" aria-label="Hacksnap home">
              <span className="logo" aria-hidden="true">
                h/
              </span>
              hacksnap
            </Link>
            <div className="header-nav">
              <MainNavigation />
              <div className="header-actions">
                <a className="rss-link" href="/feed.xml" aria-label="RSS feed" title="RSS feed">
                  <Rss size={18} strokeWidth={1.75} aria-hidden="true" />
                </a>
                <ThemeToggle />
              </div>
            </div>
          </div>
        </StickyHeader>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer id="site-footer" tabIndex={-1}>
          <Link className="footer-brand" href="/">
            hacksnap
          </Link>
          <p>AI stories and discussions from Hacker News.</p>
        </footer>
      </body>
    </html>
  );
}
