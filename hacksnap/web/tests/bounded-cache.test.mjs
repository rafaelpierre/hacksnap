import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { boundedCache } from "../lib/bounded-cache.ts";

test("coalesces loads, expires positive and negative results, and retries failures", async () => {
  let now = 0;
  let reads = 0;
  const get = boundedCache(
    async (key) => {
      reads++;
      if (key === "error") throw new Error("unavailable");
      return key === "missing" ? null : key;
    },
    { ttl: (value) => (value === null ? 60 : 300), maxEntries: 3, maxPending: 2, now: () => now },
  );
  assert.deepEqual(await Promise.all([get("a"), get("a"), get("a")]), ["a", "a", "a"]);
  assert.equal(reads, 1);
  await get("missing");
  now = 59;
  await get("missing");
  assert.equal(reads, 2);
  now = 60;
  await get("missing");
  assert.equal(reads, 3);
  now = 299;
  await get("a");
  assert.equal(reads, 3);
  now = 300;
  await get("a");
  assert.equal(reads, 4);
  await assert.rejects(get("error"));
  await assert.rejects(get("error"));
  assert.equal(reads, 6);
});

test("evicts least recently used entries and rejects excess pending distinct keys", async () => {
  let reads = 0;
  let finish;
  const get = boundedCache(
    async (key) => {
      reads++;
      if (key === "slow")
        await new Promise((resolve) => {
          finish = resolve;
        });
      return key;
    },
    { ttl: () => 1000, maxEntries: 2, maxPending: 1 },
  );
  await get("a");
  await get("b");
  await get("a");
  await get("c"); // evicts b
  assert.equal(reads, 3);
  await get("b");
  assert.equal(reads, 4);
  const pending = get("slow");
  const shared = get("slow");
  await assert.rejects(get("other"), /busy/);
  assert.equal(reads, 5);
  finish();
  assert.deepEqual(await Promise.all([pending, shared]), ["slow", "slow"]);
  await get("other");
  assert.equal(reads, 6);
});
