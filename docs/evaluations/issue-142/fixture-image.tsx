"use client";

import { useEffect, useState } from "react";
import { ArticleImage } from "../article-image";

const feedSizes =
  "(max-width: 640px) calc(100vw - 4rem), (max-width: 800px) calc(30vw - 1rem), min(calc(30vw - 5rem), 18rem)";

export function FixtureImage({
  index,
  detail,
  optimized,
}: {
  index: number;
  detail: boolean;
  optimized: boolean;
}) {
  // Mirror StoryFeed: server and first client render stay lazy until the
  // restore check completes; this fixture represents the fresh-feed case.
  const [restoreChecked, setRestoreChecked] = useState(false);
  useEffect(() => setRestoreChecked(true), []);
  const lead = detail || (index === 0 && restoreChecked);
  const src = `/fixture-image-${index}.webp`;
  const className = detail ? "story-article-image" : "feed-story-image";
  if (optimized)
    return (
      <ArticleImage
        image={{ url: src, width: 1600, height: 900, mimeType: "image/webp" }}
        alt=""
        className={className}
        loading={lead ? "eager" : "lazy"}
        fetchPriority={lead ? "high" : undefined}
        sizes={detail ? "(max-width: 720px) calc(100vw - 2rem), 43rem" : feedSizes}
      />
    );
  return (
    <div className={className}>
      <img
        src={src}
        alt=""
        width="1600"
        height="900"
        loading={detail ? "eager" : "lazy"}
        decoding="async"
      />
    </div>
  );
}
