"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordVisit, trackOnce } from "../lib/analytics";

export function JourneyAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    const match = /^\/story\/(\d+)\/?$/.exec(pathname);
    if (match) trackOnce(`story:${match[1]}`, {name: "story_view", story_id: match[1]});
  }, [pathname]);

  useEffect(() => {
    recordVisit();
  }, []);

  return null;
}
