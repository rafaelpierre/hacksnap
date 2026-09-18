import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {default: "Hacksnap — AI on Hacker News", template: "%s | Hacksnap"},
  description: "AI stories from Hacker News, with article briefs and highlights from the discussion.",
};

export default function Layout({ children }: {children: React.ReactNode}) {
  return <html lang="en"><body>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Link className="wordmark" href="/" aria-label="Hacksnap home"><span className="logo" aria-hidden="true">h/</span>hacksnap</Link>
      <span className="header-note">/ ai</span>
      <a className="header-link" href="https://news.ycombinator.com/">Hacker News ↗</a>
    </div></header>
    <main id="main">{children}</main>
    <footer><Link className="footer-brand" href="/">hacksnap</Link><p>An independent reader for Hacker News.</p></footer>
  </body></html>;
}
