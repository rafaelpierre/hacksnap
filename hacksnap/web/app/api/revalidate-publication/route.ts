import { revalidatePath, revalidateTag } from "next/cache";
import { publicationWebhook } from "../../../lib/publication-webhook";
import { PUBLICATION_TAG, POPULARITY_TAG } from "../../../lib/publication-cache";
import { getFreshStory, clearNegativeStories } from "../../../lib/data/stories";
import { storyPath } from "../../../lib/story-url";
import { CATEGORIES, categoryById, categoryURL } from "../../../lib/categories";
import { getArchiveStories, getCategoryStories } from "../../../lib/data/browse";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = publicationWebhook(async (changes, warm, request) => {
  const removal = changes.some((change) => change.kind === "removal");
  const ids = [...new Set(changes.map((change) => change.storyId))];
  clearNegativeStories(ids);
  if (!warm) {
    revalidateTag(PUBLICATION_TAG, removal ? { expire: 0 } : "max");
    revalidateTag(POPULARITY_TAG, removal ? { expire: 0 } : "max");
    // Hard path invalidation discards the last good ISR response. Use the
    // inherited publication tag for ordinary changes so outages retain it.
    // Withdrawals deliberately expire both story and OG route handlers.
    if (removal) revalidatePath("/story/[id]", "layout");
    console.info("publication_revalidated", { count: ids.length, removal });
    return;
  }
  const paths = new Set(["/"]);
  if (removal) for (const category of CATEGORIES) paths.add(categoryURL(category));
  for (const id of ids) {
    const story = await getFreshStory(id);
    if (!story) continue;
    const path = storyPath(story.hn_id, story.story_slug);
    paths.add(path);
    paths.add(`${path}/opengraph-image`);
    const category = categoryById(story.category);
    if (category) paths.add(categoryURL(category));
  }
  await getArchiveStories(null, 1);
  for (const category of CATEGORIES)
    if (paths.has(categoryURL(category))) await getCategoryStories(category.id, 1);
  const origin =
    process.env.HACKSNAP_PUBLICATION_ORIGIN ??
    (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://hacksnap.live");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Invalid publication origin");
  const previewHeaders: Record<string, string> = {};
  if (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_URL &&
    url.origin === `https://${process.env.VERCEL_URL}`
  ) {
    // Reuse the authenticated caller's protection headers only on this preview.
    for (const name of ["x-origin-secret", "x-vercel-protection-bypass"]) {
      const value = request.headers.get(name);
      if (value) previewHeaders[name] = value;
    }
  }
  // Warm only internally derived paths. Bound concurrency below the DB read budget.
  const pending = [...paths];
  await Promise.all(
    [0, 1].map(async () => {
      while (pending.length) {
        const path = pending.shift()!;
        const response = await fetch(new URL(path, url), {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: {
            ...previewHeaders,
            Accept: path.endsWith("opengraph-image") ? "image/png" : "text/html",
          },
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error("Publication warm failed");
      }
    }),
  );
  console.info("publication_warmed", { count: ids.length, removal, warmed: paths.size });
});
