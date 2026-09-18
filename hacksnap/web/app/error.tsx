"use client";

export default function ErrorPage({reset}: {reset: () => void}) {
  return <div className="empty" role="alert"><span className="eyebrow">TEMPORARILY OFFLINE</span><h1>We couldn’t load this snapshot.</h1><p>The story data is temporarily unavailable. Please try again shortly.</p><button className="button primary" onClick={reset}>Try again</button></div>;
}
