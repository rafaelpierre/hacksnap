import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { recordStoryEventSQL } from "../lib/story-events.ts";

let options;
let connectError;
let queryError;
let rollbackError;
let connectWait;
let connects;
const queries = [];
const releases = [];
const client = {
  async query(sql, values) {
    queries.push({ sql, values });
    if (sql === "ROLLBACK" && rollbackError) throw rollbackError;
    if (sql !== "ROLLBACK" && queryError) throw queryError;
    return { rows: [] };
  },
  release(discard) {
    releases.push(discard);
  },
};
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    constructor(config) {
      options = config;
    }
    on() {}
    async connect() {
      connects++;
      if (connectError) throw connectError;
      if (connectWait) await connectWait;
      return client;
    }
  },
}));
const { recordStoryEvent, storyEventsEnabled } = await import("../lib/story-events-server.ts");
const event = {
  kind: "view",
  story_id: "49802871",
  visit_id: "00000000-0000-4000-8000-000000000001",
};
const oldURL = process.env.HACKSNAP_POPULARITY_DATABASE_URL;
beforeEach(() => {
  delete globalThis.hacksnapCounterPool;
  process.env.HACKSNAP_POPULARITY_DATABASE_URL = "postgresql://hacksnap_counter@localhost/test";
  connects = 0;
  options = connectError = queryError = rollbackError = connectWait = undefined;
  queries.length = releases.length = 0;
});
afterEach(() => {
  delete globalThis.hacksnapCounterPool;
  if (oldURL === undefined) delete process.env.HACKSNAP_POPULARITY_DATABASE_URL;
  else process.env.HACKSNAP_POPULARITY_DATABASE_URL = oldURL;
});

test("writer uses its own narrow Supabase role with verified TLS and parameterized atomic SQL", async () => {
  process.env.HACKSNAP_POPULARITY_DATABASE_URL =
    "postgresql://hacksnap_counter.project:secret@aws.pooler.supabase.com:6543/postgres?sslmode=no-verify";
  await recordStoryEvent(event);
  const url = new URL(options.connectionString);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.ok(url.searchParams.get("sslrootcert").endsWith("certs/supabase-ca.crt"));
  assert.equal(options.max, 1);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.match(
    queries[0].sql,
    /BEGIN; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'/,
  );
  assert.deepEqual(queries[1], {
    sql: recordStoryEventSQL,
    values: [event.visit_id, event.story_id, "view"],
  });
  assert.equal(queries[2].sql, "COMMIT");
  assert.deepEqual(releases, [undefined]);
});

test("missing credentials disable ingestion, and a broad Supabase login cannot open a writer pool", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    delete process.env.HACKSNAP_POPULARITY_DATABASE_URL;
    assert.equal(storyEventsEnabled(), false);
    process.env.HACKSNAP_POPULARITY_DATABASE_URL =
      "postgresql://postgres:private-password@aws.pooler.supabase.com/postgres";
    await assert.rejects(recordStoryEvent(event), /Story counting is temporarily unavailable/);
    assert.equal(connects, 0);
    assert.equal(options, undefined);
    assert.ok(!JSON.stringify(log.mock.calls).includes("private-password"));
  } finally {
    log.mockRestore();
  }
});

test("writer failures roll back and evict broken clients without leaking database messages", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const secret = Object.assign(new Error("private-password private-query"), { code: "08006" });
  try {
    for (const phase of ["connect", "query", "rollback"]) {
      delete globalThis.hacksnapCounterPool;
      connectError = phase === "connect" ? secret : undefined;
      queryError = phase !== "connect" ? secret : undefined;
      rollbackError = phase === "rollback" ? secret : undefined;
      releases.length = 0;
      await assert.rejects(recordStoryEvent(event), /Story counting is temporarily unavailable/);
      assert.deepEqual(
        releases,
        phase === "connect" ? [] : [phase === "rollback" ? true : undefined],
      );
    }
    assert.ok(!JSON.stringify(log.mock.calls).includes("private-password"));
    expect(log.mock.calls.at(-1)).toEqual([
      "Hacksnap story counter write failed",
      { code: "08006" },
    ]);
  } finally {
    log.mockRestore();
  }
});

test("pending writes are capped before entering the connection queue and the budget is released", async () => {
  let unblock;
  connectWait = new Promise((resolve) => {
    unblock = resolve;
  });
  const pending = Array.from({ length: 8 }, () => recordStoryEvent(event));
  await assert.rejects(recordStoryEvent(event), /busy/);
  assert.equal(connects, 8);
  unblock();
  await Promise.all(pending);
  connectWait = undefined;
  await recordStoryEvent(event);
  assert.equal(connects, 9);
});
