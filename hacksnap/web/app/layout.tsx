import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import localFont from "next/font/local";
import { ThemeToggle } from "./theme-toggle";
import "./globals.css";

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
  title: {default: "Hacksnap — AI on Hacker News", template: "%s | Hacksnap"},
  description: "AI stories from Hacker News, with article briefs and highlights from the discussion.",
  openGraph: {
    title: "Hacksnap — AI on Hacker News",
    description: "AI stories from Hacker News, with article briefs and highlights from the discussion.",
    siteName: "Hacksnap",
    type: "website",
  },
  twitter: { card: "summary_large_image", images: [{url: "/opengraph-image", alt: "Hacksnap — AI on Hacker News"}] },
  alternates: { types: { "application/rss+xml": "https://hacksnap.live/feed.xml" } },
};

export default function Layout({ children }: {children: React.ReactNode}) {
  return <html lang="en" data-theme="dark" className={`${headlines.variable} ${reading.variable}`} suppressHydrationWarning><head>
    {/* Apply the saved theme before paint, including on cached HTML pages. */}
    <script dangerouslySetInnerHTML={{__html: `
      try {
        if (localStorage.getItem('hacksnap-theme') === 'light') {
          document.documentElement.dataset.theme = 'light';
        }
      } catch {}
    `}} />
  </head><body>
    <Script src="https://www.googletagmanager.com/gtag/js?id=G-059PVYBN82" strategy="lazyOnload" />
    {/* Queue configuration early; download the analytics library after load, when idle. */}
    <Script id="google-analytics" strategy="afterInteractive">{`
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-059PVYBN82');
    `}</Script>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Link className="wordmark" href="/" aria-label="Hacksnap home"><span className="logo" aria-hidden="true">h/</span>hacksnap</Link>
      <span className="header-note">/ ai</span>
      <nav className="header-nav" aria-label="Main navigation"><Link className="header-link" href="/archive">Archive</Link>
      <a className="header-link" href="https://news.ycombinator.com/">Hacker News ↗</a>
      <ThemeToggle /></nav>
    </div></header>
    <main id="main">{children}</main>
    <footer><Link className="footer-brand" href="/">hacksnap</Link><p>An independent reader for Hacker News. <a href="/feed.xml">RSS feed</a></p></footer>
  </body></html>;
}
