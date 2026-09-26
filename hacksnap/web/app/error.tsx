"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

export default function ErrorPage({reset}: {reset: () => void}) {
  const router = useRouter();
  function retry() {
    startTransition(() => { router.refresh(); reset(); });
  }
  return <div className="empty" role="alert"><h1>Couldn’t load the stories.</h1><p>The story data is temporarily unavailable. Please try again shortly.</p><button className="button primary" onClick={retry}>Try again</button></div>;
}
