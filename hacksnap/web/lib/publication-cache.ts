import "server-only";
import * as nextCache from "next/cache";
import { boundedCache } from "./bounded-cache";
import { ARTICLE_IMAGE_HOSTNAME } from "./article-image-origin";

export const PUBLICATION_TTL = 300;

// Optional shared caching uses time-based expiry; no external invalidation is needed.
export function publicationCachingEnabled(): boolean {
  return process.env.HACKSNAP_PUBLICATION_CACHE === "true";
}

export function storyISREnabled(): boolean {
  return publicationCachingEnabled() && process.env.HACKSNAP_STORY_ISR === "true";
}

let negativeMarker: (() => Promise<boolean>) | undefined;
export async function trackUnpublishedForISR() {
  negativeMarker ??= nextCache.unstable_cache(
    async () => true,
    ["hacksnap", "unpublished-isr-v1"],
    { revalidate: 60 },
  );
  await negativeMarker();
}
export function encodeCacheValue(value: unknown): string {
  return JSON.stringify(value, function (key, item) {
    const original: unknown = this[key];
    return original instanceof Date ? { $hacksnapDate: original.toISOString() } : item;
  });
}

export function decodeCacheValue<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1 &&
      "$hacksnapDate" in item &&
      typeof item.$hacksnapDate === "string"
    )
      return new Date(item.$hacksnapDate);
    return item;
  }) as T;
}

export function publicationCache<T>(
  name: string,
  load: (key: string) => Promise<T>,
  legacy: Parameters<typeof boundedCache<T>>[1],
  options: { seconds?: number } = {},
): (key: string) => Promise<T> {
  const shortCache = boundedCache(load, legacy);
  // Retain only concurrent work locally. A completed local copy must never
  // extend the shared cache freshness window on another Vercel instance.
  const coalesced = boundedCache(load, { ...legacy, ttl: () => 0 });
  let shared: ((key: string) => Promise<string>) | undefined;
  return async (key) => {
    if (!publicationCachingEnabled()) return shortCache(key);
    shared ??= nextCache.unstable_cache(
      async (key: string) => encodeCacheValue(await coalesced(key)),
      [
        "hacksnap",
        "public-data-expiry-v2",
        name,
        process.env.HACKSNAP_DISCUSSION_RENDERING ?? "true",
        ARTICLE_IMAGE_HOSTNAME,
      ],
      { revalidate: options.seconds ?? PUBLICATION_TTL },
    );
    return decodeCacheValue<T>(await shared(key));
  };
}
