"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { CanonicalArticleImage } from "../lib/article-image";

const MIN_IMAGE_BYTES = 2048;

export function ArticleImage({
  image,
  alt,
  className,
  loading,
  sizes,
  fetchPriority,
}: {
  image: CanonicalArticleImage | null;
  alt: string;
  className: string;
  loading: "eager" | "lazy";
  sizes: string;
  fetchPriority?: "high";
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const url = image?.url;

  useEffect(() => {
    const element = imageRef.current;
    if (!url || !element) return;
    const controller = new AbortController();
    let checked = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const checkSize = async () => {
      if (checked) return;
      checked = true;
      if (element.naturalWidth === 0) {
        setFailedURL(url);
        return;
      }
      timeout = setTimeout(() => controller.abort(), 5000);
      try {
        // Check the stored asset, not a legitimately small Next.js thumbnail.
        const response = await fetch(url, { method: "HEAD", signal: controller.signal });
        const length = response.headers.get("content-length");
        if (
          !controller.signal.aborted &&
          response.ok &&
          length !== null &&
          /^\d+$/.test(length) &&
          Number(length) < MIN_IMAGE_BYTES
        ) {
          setFailedURL(url);
        }
      } catch {
        // Missing headers, CORS and network errors leave a decoded image visible.
      } finally {
        clearTimeout(timeout);
      }
    };
    element.addEventListener("load", checkSize);
    if (element.complete) void checkSize();
    return () => {
      element.removeEventListener("load", checkSize);
      controller.abort();
      clearTimeout(timeout);
    };
  }, [url]);

  if (!image || failedURL === url) return null;
  return (
    <div className={className}>
      <Image
        src={image.url}
        alt={alt}
        width={image.width}
        height={image.height}
        onError={() => setFailedURL(image.url)}
        ref={imageRef}
        loading={loading}
        sizes={sizes}
        fetchPriority={fetchPriority}
        decoding="async"
      />
    </div>
  );
}
