import "server-only";
import type { PoolClient } from "pg";
import { read } from "./read";
import { storySlugColumnSQL, storySlugProjection } from "../story-slug-projection";
import { browseCapabilitiesSQL } from "../browse-capabilities";
import {
  feedFields,
  feedFieldsWithoutImages,
  storyFields,
  storyFieldsWithoutImages,
  legacyFeedFields,
  legacyFeedFieldsWithoutImages,
  legacyStoryFields,
  legacyStoryFieldsWithoutImages,
  discussionColumnsSQL,
  imageColumnsSQL,
  exportFields,
  exportFieldsWithoutImages,
} from "../story-projection";

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

function feedProjection(discussionAvailable: boolean, imagesAvailable: boolean): string {
  return discussionAvailable
    ? imagesAvailable
      ? feedFields
      : feedFieldsWithoutImages
    : imagesAvailable
      ? legacyFeedFields
      : legacyFeedFieldsWithoutImages;
}

// Check on each cache miss so applying the migration needs no process restart.
export function readStories<T>(
  kind: "feed" | "story" | "export",
  query: (client: PoolClient, fields: string) => Promise<T>,
): Promise<T> {
  return read(async (client) => {
    const [discussionAvailable, imagesAvailable] = await Promise.all([
      hasDiscussionColumns(client),
      hasImageColumns(client),
    ]);
    const fields =
      kind === "export"
        ? imagesAvailable
          ? exportFields
          : exportFieldsWithoutImages
        : kind === "feed"
          ? feedProjection(discussionAvailable, imagesAvailable)
          : discussionAvailable
            ? imagesAvailable
              ? storyFields
              : storyFieldsWithoutImages
            : imagesAvailable
              ? legacyStoryFields
              : legacyStoryFieldsWithoutImages;
    return query(client, `${fields}, ${await storySlugField(client)}`);
  });
}

// Lists need all three capabilities. Resolve them in one catalog query while
// retaining the same migration and reader-grant fallback as other story reads.
export function readBrowseStories<T>(
  query: (client: PoolClient, fields: string) => Promise<T>,
): Promise<T> {
  return read(async (client) => {
    const { rows } = await client.query<{
      discussion_available: boolean;
      images_available: boolean;
      slug_available: boolean;
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
      `${feedProjection(discussionAvailable, capabilities.images_available)}, ${storySlugProjection(capabilities.slug_available)}`,
    );
  });
}
