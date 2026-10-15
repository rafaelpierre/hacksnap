import "server-only";
import { timingSafeEqual } from "node:crypto";
import { validStoryId } from "./public-story";

export type PublicationChange = {
  storyId: string;
  kind: "publication" | "correction" | "image" | "removal";
};
const kinds = new Set(["publication", "correction", "image", "removal"]);
const headers = { "Cache-Control": "no-store" };

export function publicationWebhook(
  notify: (changes: PublicationChange[], warm: boolean) => Promise<void>,
) {
  return async (request: Request): Promise<Response> => {
    const secret = process.env.HACKSNAP_PUBLICATION_SECRET;
    if (!secret || secret.length < 32) return new Response("Unavailable", { status: 503, headers });
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return new Response("Unauthorized", { status: 401, headers });
    const phase = request.headers.get("x-hacksnap-publication-phase");
    if (phase !== null && phase !== "warm")
      return new Response("Invalid phase", { status: 400, headers });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return new Response("Expected JSON", { status: 415, headers });
    const reader = request.body?.getReader();
    if (!reader) return new Response("Invalid payload", { status: 400, headers });
    let body = "";
    let size = 0;
    const decoder = new TextDecoder();
    let changes: PublicationChange[];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return new Response("Payload too large", { status: 413, headers });
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      const payload = JSON.parse(body);
      if (
        !payload ||
        Object.keys(payload).join() !== "changes" ||
        !Array.isArray(payload.changes) ||
        payload.changes.length < 1 ||
        payload.changes.length > 32 ||
        !payload.changes.every((item: unknown) => {
          if (!item || typeof item !== "object") return false;
          const value = item as Record<string, unknown>;
          return (
            Object.keys(value).length === 2 &&
            typeof value.storyId === "string" &&
            validStoryId(value.storyId) &&
            typeof value.kind === "string" &&
            kinds.has(value.kind)
          );
        })
      )
        throw new Error("Invalid payload");
      changes = payload.changes;
    } catch {
      return new Response("Invalid payload", { status: 400, headers });
    } finally {
      reader.releaseLock();
    }
    try {
      await notify(changes, phase === "warm");
      return Response.json({ revalidated: true }, { headers });
    } catch {
      console.error("publication_revalidation_failed", { count: changes.length });
      return new Response("Revalidation unavailable", { status: 503, headers });
    }
  };
}
