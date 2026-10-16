import "server-only";
import * as nextCache from "next/cache";
import { boundedCache } from "./bounded-cache";
import { ARTICLE_IMAGE_HOSTNAME } from "./article-image-origin";

export const PUBLICATION_TAG = "hacksnap:publication:v1";
export const POPULARITY_TAG = "hacksnap:popularity:v1";
export const PUBLICATION_TTL = 86_400;

// Enable only after the publication webhook has successfully received a delivery.
export function publicationCachingEnabled(): boolean {
  return process.env.HACKSNAP_PUBLICATION_CACHE === "true";
}

export function storyISREnabled(): boolean {
  return publicationCachingEnabled() && process.env.HACKSNAP_STORY_ISR === "true";
}

let publicationMarker: (() => Promise<boolean>) | undefined;
let negativeMarker: (() => Promise<boolean>) | undefined;
export async function trackUnpublishedForISR() {
  negativeMarker ??= nextCache.unstable_cache(
    async () => true,
    ["hacksnap", "unpublished-isr-v1"],
    { revalidate: 60, tags: [PUBLICATION_TAG] },
  );
  await negativeMarker();
}
// Attach the publication tag to ISR output without caching the story read.
export async function trackPublicationForISR() {
  publicationMarker ??= nextCache.unstable_cache(
    async () => true,
    ["hacksnap", "isr-publication-v1"],
    { revalidate: PUBLICATION_TTL, tags: [PUBLICATION_TAG] },
  );
  await publicationMarker();
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
  options: { seconds?: number; tags?: string[] } = {},
): (key: string) => Promise<T> {
  const shortCache = boundedCache(load, legacy);
  // Retain only concurrent work locally. A completed local copy must never
  // survive a shared-cache invalidation on another Vercel instance.
  const coalesced = boundedCache(load, { ...legacy, ttl: () => 0 });
  let shared: ((key: string) => Promise<string>) | undefined;
  return async (key) => {
    if (!publicationCachingEnabled()) return shortCache(key);
    shared ??= nextCache.unstable_cache(
      async (key: string) => encodeCacheValue(await coalesced(key)),
      [
        "hacksnap",
        "public-data-v1",
        name,
        process.env.HACKSNAP_DISCUSSION_RENDERING ?? "true",
        ARTICLE_IMAGE_HOSTNAME,
      ],
      { revalidate: options.seconds ?? PUBLICATION_TTL, tags: options.tags ?? [PUBLICATION_TAG] },
    );
    return decodeCacheValue<T>(await shared(key));
  };
}
