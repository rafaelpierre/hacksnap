import "server-only";
import type { PoolClient } from "pg";
import { read } from "./read";
import { storySlugColumnSQL, storySlugProjection } from "../story-slug-projection";
import { browseCapabilitiesSQL } from "../browse-capabilities";
import { storyIdentityColumnsSQL, storyTitleProjection } from "../story-title-projection";
import { storyProjection, discussionColumnsSQL, imageColumnsSQL } from "../story-projection";

async function hasDiscussionColumns(client: PoolClient): Promise<boolean> {
  if (process.env.HACKSNAP_DISCUSSION_RENDERING === "false") return false;
  const { rows } = await client.query<{ available: boolean }>(discussionColumnsSQL);
  const available = rows[0].available;
  if (!available) {
    console.warn(
      "Hacksnap discussion analysis unavailable: apply migration 0012 and its reader grants",
    );
  }
  return available;
}

async function hasImageColumns(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ available: boolean }>(imageColumnsSQL);
  const available = rows[0].available;
  if (!available) {
    console.warn(
      "Hacksnap stored images unavailable: apply migrations through 0022 and reader grants",
    );
  }
  return available;
}

export async function storySlugField(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ available: boolean }>(storySlugColumnSQL);
  return storySlugProjection(rows[0]?.available === true);
}

export async function storyIdentityFields(client: PoolClient) {
  const { rows } = await client.query<{
    slug_available: boolean;
    title_available: boolean;
    initial_metrics_available: boolean;
  }>(storyIdentityColumnsSQL);
  return {
    slug: storySlugProjection(rows[0]?.slug_available === true),
    title: storyTitleProjection(rows[0]?.title_available === true),
    titleAvailable: rows[0]?.title_available === true,
    metricsAvailable: rows[0]?.initial_metrics_available === true,
  };
}

// Check on each cache miss so applying the migration needs no process restart.
export function readStories<T>(
  kind: "feed" | "story" | "export",
  query: (client: PoolClient, fields: string) => Promise<T>,
): Promise<T> {
  return read(async (client) => {
    const [discussionAvailable, imagesAvailable, identity] = await Promise.all([
      hasDiscussionColumns(client),
      hasImageColumns(client),
      storyIdentityFields(client),
    ]);
    const fields = storyProjection(
      kind,
      discussionAvailable,
      imagesAvailable,
      identity.titleAvailable,
      identity.metricsAvailable,
    );
    return query(client, `${fields}, ${identity.slug}`);
  });
}

// Resolve list capabilities in one catalog query while
// retaining the same migration and reader-grant fallback as other story reads.
export function readBrowseStories<T>(
  query: (client: PoolClient, fields: string) => Promise<T>,
): Promise<T> {
  return read(async (client) => {
    const { rows } = await client.query<{
      discussion_available: boolean;
      images_available: boolean;
      slug_available: boolean;
      title_available: boolean;
      initial_metrics_available: boolean;
    }>(browseCapabilitiesSQL);
    const capabilities = rows[0];
    if (!capabilities) throw new Error("Story capabilities unavailable");
    const discussionAvailable =
      process.env.HACKSNAP_DISCUSSION_RENDERING !== "false" && capabilities.discussion_available;
    if (!discussionAvailable && process.env.HACKSNAP_DISCUSSION_RENDERING !== "false")
      console.warn(
        "Hacksnap discussion analysis unavailable: apply migration 0012 and its reader grants",
      );
    if (!capabilities.images_available)
      console.warn(
        "Hacksnap stored images unavailable: apply migrations through 0022 and reader grants",
      );
    return query(
      client,
      `${storyProjection("feed", discussionAvailable, capabilities.images_available, capabilities.title_available, capabilities.initial_metrics_available === true)}, ${storySlugProjection(capabilities.slug_available)}`,
    );
  });
}
