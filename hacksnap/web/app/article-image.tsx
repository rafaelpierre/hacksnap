"use client";

import { useEffect, useRef, useState } from "react";
import { articleThumbnailFit, type CanonicalArticleImage } from "../lib/article-image";

export function ArticleImage({
  image,
  alt,
  className,
  loading,
  adaptiveFit = false,
}: {
  image: CanonicalArticleImage | null;
  alt: string;
  className: string;
  loading: "eager" | "lazy";
  adaptiveFit?: boolean;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const failed = failedURL === image?.url;
  const [frameAspectRatio, setFrameAspectRatio] = useState(4 / 3);

  useEffect(() => {
    const element = imageRef.current;
    if (image && element?.complete && element.naturalWidth === 0) setFailedURL(image.url);
  }, [image]);

  useEffect(() => {
    const element = imageRef.current;
    if (!adaptiveFit || !element || typeof ResizeObserver === "undefined") return;
    // Mobile max-height and text zoom can change the frame's actual proportions.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setFrameAspectRatio(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [adaptiveFit, image?.url, failed]);

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
        style={
          adaptiveFit ? { objectFit: articleThumbnailFit(image, frameAspectRatio) } : undefined
        }
      />
    </div>
  );
}
