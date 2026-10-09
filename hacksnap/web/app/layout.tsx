import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import localFont from "next/font/local";
import { SiteHeader } from "./sticky-header";
import { MainNavigation, MobileNavigation } from "./main-navigation";
import { TopicSidebar } from "./topic-sidebar";
import { SiteContent } from "./site-content";
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

const editorial = localFont({
  src: [
    { path: "./fonts/newsreader-latin-variable.woff2", weight: "200 800", style: "normal" },
    { path: "./fonts/newsreader-latin-italic-variable.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-editorial",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

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
    <html lang="en" className={`${headlines.variable} ${reading.variable} ${editorial.variable}`}>
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
      </head>
      <body>
        {/* Queue visits early; fetch GA only after the reader interacts. */}
        <Script id="google-analytics" strategy="beforeInteractive">
          {analyticsBootstrap}
        </Script>
        <Suspense fallback={null}>
          <ReaderVisit />
        </Suspense>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader>
          <div className="header-inner">
            <Link className="wordmark" href="/" aria-label="Hacksnap home">
              <span className="logo" aria-hidden="true">
                h/
              </span>
              hacksnap
            </Link>
            <MainNavigation />
            <MobileNavigation />
          </div>
        </SiteHeader>
        <div className="site-shell">
          <TopicSidebar />
          <main id="main" className="site-main" tabIndex={-1}>
            <SiteContent>{children}</SiteContent>
          </main>
        </div>
      </body>
    </html>
  );
}
