"use client";

export default function ErrorPage({reset}: {reset: () => void}) {
  return <div className="empty" role="alert"><h1>Couldn’t load the stories.</h1><p>The story data is temporarily unavailable. Please try again shortly.</p><button className="button primary" onClick={reset}>Try again</button></div>;
}
