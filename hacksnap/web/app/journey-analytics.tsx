"use client";

import {useEffect, useRef, type ReactNode} from "react";
import {usePathname} from "next/navigation";
import {recordVisit, track} from "../lib/analytics";

export function ReaderVisit() {
  const path = usePathname();
  useEffect(() => { track("reader_visit", {}, "visit"); }, [path]);
  useEffect(() => { recordVisit(); }, []);
  return null;
}

export function StoryVisit({id}: {id: string}) {
  const path = usePathname();
  useEffect(() => { track("story_view", {story_id: id}, `story:${id}`); }, [id, path]);
  return null;
}

/** Exposure means at least half the recommendation is visible, not merely rendered. */
export function Recommendation({source, target, position, children}: {source: string; target: string; position: number; children: ReactNode}) {
  const root = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const params = {story_id: source, target_story_id: target, position, placement: "read_next"};
  const key = `recommendation:${source}:${target}:${position}`;
  function expose() { track("recommendation_exposure", params, key); }
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
        track("recommendation_exposure", {story_id: source, target_story_id: target, position, placement: "read_next"}, key);
        observer.disconnect();
      }
    }, {threshold: 0.5});
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [source, target, position, key, path]);
  function click(event: React.MouseEvent) {
    if (!(event.target instanceof Element) || !event.target.closest("a")) return;
    // A click proves exposure even before the observer fires (or without observer support).
    expose();
    track("recommendation_click", params, `click:${key}`);
  }
  return <div ref={root} onClickCapture={click} onAuxClickCapture={event => { if (event.button === 1) click(event); }}>{children}</div>;
}
