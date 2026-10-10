import "server-only";
import path from "node:path";
import { Pool } from "pg";

export type ReadPool = "hacksnapPool" | "hacksnapTrendingPool";
type PoolKey = ReadPool | "hacksnapCounterPool";
const globalDB = globalThis as unknown as Partial<Record<PoolKey, Pool>>;

const roles = {
  reader: {
    variable: "HACKSNAP_WEB_DATABASE_URL",
    role: "hacksnap_reader",
    missing: "HACKSNAP_WEB_DATABASE_URL is required",
    invalid: "Hacksnap database URL is invalid",
    wrongRole: "Supabase web connections require the hacksnap_reader role",
    failure: "Hacksnap database connection failed",
    timeout: 10000,
  },
  counter: {
    variable: "HACKSNAP_POPULARITY_DATABASE_URL",
    role: "hacksnap_counter",
    missing: "Story counting is unavailable",
    invalid: "Story counter database URL is invalid",
    wrongRole: "Supabase story counter connections require the hacksnap_counter role",
    failure: "Hacksnap story counter connection failed",
    timeout: 5000,
  },
} as const;

export function databasePool(key: PoolKey): Pool {
  const existing = globalDB[key];
  if (existing) return existing;
  const config = key === "hacksnapCounterPool" ? roles.counter : roles.reader;
  let connectionString = process.env[config.variable];
  if (!connectionString) throw new Error(config.missing);
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(config.invalid);
  }
  if (url.hostname.endsWith(".pooler.supabase.com") || url.hostname.endsWith(".supabase.co")) {
    if (decodeURIComponent(url.username).split(".")[0] !== config.role)
      throw new Error(config.wrongRole);
    url.searchParams.set("sslmode", "verify-full");
    if (!url.searchParams.has("sslrootcert"))
      url.searchParams.set("sslrootcert", path.join(process.cwd(), "certs", "supabase-ca.crt"));
    connectionString = url.toString();
  }
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: config.timeout,
    idleTimeoutMillis: 90000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => console.error(config.failure));
  globalDB[key] = pool;
  return pool;
}
