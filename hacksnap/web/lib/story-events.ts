import { validStoryId } from "./public-story";

export type StoryEvent = { kind: "view" | "click"; story_id: string; visit_id: string };
export const MAX_STORY_EVENT_BYTES = 1024;

export function parseStoryEvent(value: unknown): StoryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 3 ||
    (fields.kind !== "view" && fields.kind !== "click") ||
    typeof fields.story_id !== "string" ||
    !validStoryId(fields.story_id) ||
    typeof fields.visit_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      fields.visit_id,
    )
  )
    return null;
  return { kind: fields.kind, story_id: fields.story_id, visit_id: fields.visit_id };
}

export const recordStoryEventSQL = `WITH accepted AS (
  INSERT INTO public.hacksnap_popularity_events (visit_id, story_id, kind)
  SELECT $1::uuid, t.hn_id, $3::text
  FROM public.hacker_news_threads t
  WHERE t.hn_id = $2::bigint AND t.hn_id BETWEEN 1 AND 999999999999999
    AND t.date_added <= CURRENT_TIMESTAMP
    AND EXISTS (SELECT 1 FROM public.hacksnap_popularity_state
                WHERE singleton AND tracking_started_at IS NOT NULL)
  ON CONFLICT (visit_id, story_id, kind) DO NOTHING
  RETURNING story_id, kind
)
INSERT INTO public.hacksnap_story_popularity (story_id, story_views, story_clicks)
SELECT story_id, CASE WHEN kind = 'view' THEN 1 ELSE 0 END,
  CASE WHEN kind = 'click' THEN 1 ELSE 0 END FROM accepted
ON CONFLICT (story_id) DO UPDATE SET
  story_views = hacksnap_story_popularity.story_views + EXCLUDED.story_views,
  story_clicks = hacksnap_story_popularity.story_clicks + EXCLUDED.story_clicks`;

// A fixed per-instance ceiling bounds anonymous bursts without retaining IPs or identities.
export function storyEventBudget(now: () => number = Date.now, limit = 120) {
  let window = now();
  let used = 0;
  return () => {
    const time = now();
    if (time - window >= 60_000 || time < window) {
      window = time;
      used = 0;
    }
    if (used >= limit) return false;
    used++;
    return true;
  };
}

class BodyLimitError extends Error {}

async function boundedJSON(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_STORY_EVENT_BYTES) {
        await reader.cancel();
        throw new BodyLimitError("Oversized body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createStoryEventHandler(dependencies: {
  enabled: () => boolean;
  allow: () => boolean;
  record: (event: StoryEvent) => Promise<void>;
}) {
  return async (request: Request): Promise<Response> => {
    const respond = (status: number) =>
      new Response(null, { status, headers: { "Cache-Control": "no-store" } });
    if (!dependencies.enabled()) return respond(204);
    const origin = request.headers.get("origin");
    if (
      !origin ||
      origin !== new URL(request.url).origin ||
      (request.headers.get("sec-fetch-site") &&
        request.headers.get("sec-fetch-site") !== "same-origin")
    )
      return respond(403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return respond(415);
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_STORY_EVENT_BYTES))
      return respond(413);
    if (!dependencies.allow()) return respond(429);
    let event: StoryEvent | null;
    try {
      event = parseStoryEvent(await boundedJSON(request));
    } catch (error) {
      return respond(error instanceof BodyLimitError ? 413 : 400);
    }
    if (!event) return respond(400);
    try {
      await dependencies.record(event);
      return respond(204);
    } catch {
      return respond(503);
    }
  };
}
