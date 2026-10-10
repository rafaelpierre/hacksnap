import assert from "node:assert/strict";
import { afterEach, beforeEach, jest, test } from "@jest/globals";

const pools = [];
let connects = 0;
let holdReads;
let failConnect = false;
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    constructor(options) {
      this.options = options;
      pools.push(this);
    }
    on() {}
    async connect() {
      connects++;
      if (failConnect) throw new Error("private connection diagnostic");
      if (!this.options.connectionString.includes("counter")) await holdReads;
      return {
        async query(statement) {
          const sql = typeof statement === "string" ? statement : statement.text;
          if (sql.includes("discussion_available"))
            return {
              rows: [{ discussion_available: true, images_available: true, slug_available: true }],
            };
          if (sql.includes("AS available")) return { rows: [{ available: true }] };
          return { rows: [] };
        },
        release() {},
      };
    }
  },
}));
const { databasePool } = await import("../lib/database-pool.ts");
const data = await import("../lib/data.ts");
const { recordStoryEvent } = await import("../lib/story-events-server.ts");
const keys = ["hacksnapPool", "hacksnapTrendingPool", "hacksnapCounterPool"];
const oldReader = process.env.HACKSNAP_WEB_DATABASE_URL;
const oldWriter = process.env.HACKSNAP_POPULARITY_DATABASE_URL;
let clock = Date.now();
let now;
beforeEach(() => {
  clock += 1_800_001;
  now = jest.spyOn(Date, "now").mockImplementation(() => clock);
  keys.forEach((key) => delete globalThis[key]);
  pools.length = 0;
  connects = 0;
  failConnect = false;
  holdReads = undefined;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/fixture";
  process.env.HACKSNAP_POPULARITY_DATABASE_URL = "postgresql://counter@localhost/fixture";
});
afterEach(() => {
  now.mockRestore();
  keys.forEach((key) => delete globalThis[key]);
  if (oldReader === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
  else process.env.HACKSNAP_WEB_DATABASE_URL = oldReader;
  if (oldWriter === undefined) delete process.env.HACKSNAP_POPULARITY_DATABASE_URL;
  else process.env.HACKSNAP_POPULARITY_DATABASE_URL = oldWriter;
});

test("all reader modules share a budget, including uncached exports, while counter writes stay isolated", async () => {
  let release;
  holdReads = new Promise((resolve) => {
    release = resolve;
  });
  const pending = [
    ...["101", "102", "103", "104"].map(data.getStory),
    data.getStoryMetrics("105"),
    data.getStoryMetrics("106"),
    data.getArchiveStories(null, 1),
    data.getSitemapStories(),
  ];
  const coalesced = data.getStory("101");
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(connects, 8);
    for (const load of [
      data.getRssStories,
      data.getSitemapStories,
      () => data.getPopularStories("last-7-days"),
    ])
      await assert.rejects(load(), { name: "DataUnavailableError" });
    assert.equal(connects, 8, "rejected work never enters either reader pool");
    await recordStoryEvent({
      kind: "view",
      story_id: "101",
      visit_id: "00000000-0000-4000-8000-000000000001",
    });
    assert.equal(connects, 9, "writer retains its separate queue and credentials");
  } finally {
    release();
    await Promise.all([...pending, coalesced]);
  }
  await data.getSitemapStories();
  assert.equal(connects, 10);
});

test("failed pool acquisitions release the shared budget", async () => {
  failConnect = true;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (let i = 0; i < 10; i++)
      await assert.rejects(data.getSitemapStories(), { name: "DataUnavailableError" });
    failConnect = false;
    await data.getSitemapStories();
    assert.equal(connects, 11);
    assert.doesNotMatch(JSON.stringify(log.mock.calls), /private connection diagnostic/);
  } finally {
    log.mockRestore();
  }
});

test.each(keys)("%s preserves TLS, role, timeout, and pool identity", (key) => {
  const counter = key === "hacksnapCounterPool";
  const variable = counter ? "HACKSNAP_POPULARITY_DATABASE_URL" : "HACKSNAP_WEB_DATABASE_URL";
  const role = counter ? "hacksnap_counter" : "hacksnap_reader";
  process.env[variable] =
    `postgresql://${role}.project@aws.pooler.supabase.com/db?sslmode=disable&sslrootcert=%2Fcustom%2Fca.crt`;
  const pool = databasePool(key);
  assert.equal(databasePool(key), pool);
  const url = new URL(pool.options.connectionString);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("sslrootcert"), "/custom/ca.crt");
  assert.equal(pool.options.max, 1);
  assert.equal(pool.options.connectionTimeoutMillis, counter ? 5000 : 10000);
  assert.equal(pool.options.idleTimeoutMillis, 90000);
  assert.equal(pool.options.allowExitOnIdle, true);
  delete globalThis[key];
  process.env[variable] =
    `postgresql://${counter ? "hacksnap_reader" : "hacksnap_counter"}@db.project.supabase.co/db`;
  assert.throws(() => databasePool(key), new RegExp(`${role} role`));
  assert.equal(pools.length, 1, "wrong-role connection is rejected before pool construction");
});

test("local connection settings remain intact and pools are lazy without credentials", () => {
  const local = "postgresql://reader@localhost/db?sslmode=disable";
  process.env.HACKSNAP_WEB_DATABASE_URL = local;
  assert.equal(databasePool("hacksnapPool").options.connectionString, local);
  delete globalThis.hacksnapPool;
  delete process.env.HACKSNAP_WEB_DATABASE_URL;
  assert.throws(() => databasePool("hacksnapPool"), /HACKSNAP_WEB_DATABASE_URL is required/);
  assert.equal(pools.length, 1);
});
