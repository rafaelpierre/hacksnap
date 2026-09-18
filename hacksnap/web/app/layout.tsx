import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {default: "Hacksnap — AI news, with the arguments attached", template: "%s | Hacksnap"},
  description: "The top AI stories on Hacker News. Read the article's claims and the discussion's sharpest arguments, separately.",
};

export default function Layout({ children }: {children: React.ReactNode}) {
  return <html lang="en"><body>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><Link className="wordmark" href="/" aria-label="Hacksnap home">
      <span className="logo" aria-hidden="true">h/</span>hacksnap<span className="wordmark-dot">.</span>
    </Link><span className="header-note">THE SIGNAL &amp; THE COMMENTS</span>
      <a className="header-link" href="https://news.ycombinator.com/">Hacker News <span aria-hidden="true">↗</span></a>
    </header>
    <main id="main">{children}</main>
    <footer><Link className="footer-brand" href="/">hacksnap.</Link>
      <p>AI summaries. Human arguments. Always check the sources.</p>
      <span>Independent of Hacker News.</span></footer>
  </body></html>;
}
