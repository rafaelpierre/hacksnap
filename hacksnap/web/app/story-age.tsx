"use client";

import { useEffect, useState } from "react";

export function formatStoryAge(dateTime: string, now: number): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(dateTime)) / 3_600_000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder ? `${days}d ${remainder}h` : `${days}d`;
}

export function StoryAge({ dateTime }: { dateTime: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const exact = new Date(dateTime).toUTCString();
  return (
    <time className="story-age" dateTime={dateTime} aria-label={`Story added ${exact}`}>
      {now === null ? dateTime.slice(0, 10) : formatStoryAge(dateTime, now)}
    </time>
  );
}
