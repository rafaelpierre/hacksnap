import "server-only";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { pendingBudget } from "./bounded-cache";
import { recordStoryEventSQL, type StoryEvent } from "./story-events";

const globalDB = globalThis as unknown as { hacksnapCounterPool?: Pool };
const writes = pendingBudget(8);

export function storyEventsEnabled(): boolean {
  return Boolean(process.env.HACKSNAP_POPULARITY_DATABASE_URL);
}

function pool(): Pool {
  if (!globalDB.hacksnapCounterPool) {
    let connectionString = process.env.HACKSNAP_POPULARITY_DATABASE_URL;
    if (!connectionString) throw new Error("Story counting is unavailable");
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      throw new Error("Story counter database URL is invalid");
    }
    if (url.hostname.endsWith(".pooler.supabase.com") || url.hostname.endsWith(".supabase.co")) {
      if (decodeURIComponent(url.username).split(".")[0] !== "hacksnap_counter")
        throw new Error("Supabase story counter connections require the hacksnap_counter role");
      url.searchParams.set("sslmode", "verify-full");
      if (!url.searchParams.has("sslrootcert"))
        url.searchParams.set("sslrootcert", path.join(process.cwd(), "certs", "supabase-ca.crt"));
      connectionString = url.toString();
    }
    globalDB.hacksnapCounterPool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 90000,
      allowExitOnIdle: true,
    });
    globalDB.hacksnapCounterPool.on("error", () =>
      console.error("Hacksnap story counter connection failed"),
    );
  }
  return globalDB.hacksnapCounterPool;
}

export async function recordStoryEvent(event: StoryEvent): Promise<void> {
  if (!writes.acquire()) throw new Error("Story counter is busy");
  let client: PoolClient | undefined;
  try {
    client = await pool().connect();
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
