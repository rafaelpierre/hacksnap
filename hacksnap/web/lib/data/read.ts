import "server-only";
import type { PoolClient } from "pg";
import { databasePool, type ReadPool } from "../database-pool";
import { DataUnavailableError } from "../data-availability";
import { readWorkload } from "./cache-policy";

export async function read<T>(
  query: (client: PoolClient) => Promise<T>,
  poolKey: ReadPool = "hacksnapPool",
): Promise<T> {
  if (!readWorkload.acquire()) throw new DataUnavailableError();
  let client: PoolClient | undefined;
  try {
    client = await databasePool(poolKey).connect();
    // Transaction pooling does not preserve session-level settings.
    await client.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout = '10s'",
    );
    const result = await query(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // SQLSTATE is useful operationally; messages can contain private query data.
    const code = (error as { code?: unknown } | null)?.code;
    console.error("Hacksnap database read failed", {
      code: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown",
    });
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Evict a broken connection without replacing the sanitized read error.
        client.release(true);
        client = undefined;
      }
    }
    throw new DataUnavailableError();
  } finally {
    client?.release();
    readWorkload.release();
  }
}
