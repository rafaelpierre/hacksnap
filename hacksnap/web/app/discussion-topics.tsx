"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function DiscussionTopics({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame: number | undefined;
    function revealTopic() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      const topic = document.getElementById(id);
      if (!topic?.matches(".analysis-theme") || !container.current?.contains(topic)) return;
      const details = topic.querySelector("details");
      if (!details) return;
      details.open = true;
      frame = requestAnimationFrame(() => topic.scrollIntoView({ block: "start" }));
    }

    revealTopic();
    window.addEventListener("hashchange", revealTopic);
    return () => {
      window.removeEventListener("hashchange", revealTopic);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [children]);

  return (
    <div className="analysis-themes" ref={container}>
      {children}
    </div>
  );
}
