import "server-only";
import type { PoolClient } from "pg";
import { databasePool } from "./database-pool";
import { pendingBudget } from "./bounded-cache";
import { recordStoryEventSQL, type StoryEvent } from "./story-events";

const writes = pendingBudget(8);

export function storyEventsEnabled(): boolean {
  return Boolean(process.env.HACKSNAP_POPULARITY_DATABASE_URL);
}

export async function recordStoryEvent(event: StoryEvent): Promise<void> {
  if (!writes.acquire()) throw new Error("Story counter is busy");
  let client: PoolClient | undefined;
  try {
    client = await databasePool("hacksnapCounterPool").connect();
    await client.query("BEGIN; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'");
    await client.query(recordStoryEventSQL, [event.visit_id, event.story_id, event.kind]);
    await client.query("COMMIT");
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error("Hacksnap story counter write failed", {
      code: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown",
    });
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        client.release(true);
        client = undefined;
      }
    }
    throw new Error("Story counting is temporarily unavailable");
  } finally {
    client?.release();
    writes.release();
  }
}
