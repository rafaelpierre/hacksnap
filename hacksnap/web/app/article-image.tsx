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

  if (!image || failed) return null;
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
