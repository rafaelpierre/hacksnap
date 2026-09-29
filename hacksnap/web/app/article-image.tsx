"use client";

import { useEffect, useRef, useState } from "react";
import type { CanonicalArticleImage } from "../lib/article-image";

export function ArticleImage({
  image,
  alt,
  className,
  loading,
}: {
  image: CanonicalArticleImage | null;
  alt: string;
  className: string;
  loading: "eager" | "lazy";
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const failed = failedURL === image?.url;

  useEffect(() => {
    const element = imageRef.current;
    if (image && element?.complete && element.naturalWidth === 0) setFailedURL(image.url);
  }, [image]);

  if (!image) return null;
  if (failed) {
    return (
      <div
        className={`${className} article-image-unavailable`}
        style={
          className.includes("story-article-image")
            ? { aspectRatio: `${image.width} / ${image.height}` }
            : undefined
        }
        {...(alt
          ? { role: "img", "aria-label": `${alt}. Image unavailable.` }
          : { "aria-hidden": true })}
      >
        <span aria-hidden="true">h/</span>
      </div>
    );
  }
  return (
    <div className={className}>
      <img
        src={image.url}
        alt={alt}
        width={image.width}
        height={image.height}
        onError={() => setFailedURL(image.url)}
        ref={imageRef}
        loading={loading}
        decoding="async"
      />
    </div>
  );
}
