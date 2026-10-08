import assert from "node:assert/strict";
import { afterAll, beforeEach, jest, test } from "@jest/globals";
import { popularityAvailableSQL, weeklyPopularityAvailableSQL } from "../lib/popular-stories.ts";
import { storySlugColumnSQL } from "../lib/story-slug-projection.ts";

let clock = Date.now();
const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
let available = true;
let failure;
const queries = [];
const story = { hn_id: "49802871", title: "Popular", story_slug: null, views: "322" };
const client = {
  async query(sql) {
    queries.push(sql);
    if (failure && sql !== "ROLLBACK") throw failure;
    if (sql === popularityAvailableSQL || sql === weeklyPopularityAvailableSQL)
      return { rows: [{ available }] };
    if (sql === storySlugColumnSQL) return { rows: [{ available: false }] };
    return { rows: [story] };
  },
  release() {},
};
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    on() {}
    async connect() {
      return client;
    }
  },
}));
const { getPopularStories } = await import("../lib/data.ts");
const oldURL = process.env.HACKSNAP_WEB_DATABASE_URL;
beforeEach(() => {
  clock += 300_001;
  available = true;
  failure = undefined;
  queries.length = 0;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
});

test("weekly and lifetime loads have independent cache keys and rollout checks", async () => {
  await Promise.all([getPopularStories("last-7-days"), getPopularStories("all-time")]);
  assert.equal(queries.includes(weeklyPopularityAvailableSQL), true);
  assert.equal(queries.includes(popularityAvailableSQL), true);
  assert.equal(queries.filter((sql) => sql.includes("JOIN public.hacker_news_threads")).length, 2);
  queries.length = 0;
  await Promise.all([getPopularStories("last-7-days"), getPopularStories("all-time")]);
  assert.equal(queries.length, 0);
  clock += 300_001;
  available = false;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await assert.rejects(getPopularStories("last-7-days"), /temporarily unavailable/);
    assert.deepEqual(await getPopularStories("all-time"), []);
  } finally {
    log.mockRestore();
  }
});
afterAll(() => {
  now.mockRestore();
  if (oldURL === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
  else process.env.HACKSNAP_WEB_DATABASE_URL = oldURL;
});

test("optional popularity loader needs no credentials and tolerates a missing schema/grant", async () => {
  delete process.env.HACKSNAP_WEB_DATABASE_URL;
  assert.deepEqual(await getPopularStories(), []);
  assert.equal(queries.length, 0);
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  available = false;
  assert.deepEqual(await getPopularStories(), []);
  assert.equal(queries.includes(popularityAvailableSQL), true);
  assert.equal(
    queries.some((sql) => sql.includes("JOIN public.hacker_news_threads")),
    false,
  );
  clock += 300_001;
  available = true;
  assert.deepEqual(await getPopularStories(), [story]);
});

test("popularity coalesces requests for five minutes and preserves the read-only transaction", async () => {
  assert.deepEqual(await Promise.all([getPopularStories(), getPopularStories()]), [
    [story],
    [story],
  ]);
  assert.equal(queries.filter((sql) => sql.includes("JOIN public.hacker_news_threads")).length, 1);
  assert.match(queries[0], /READ ONLY; SET LOCAL statement_timeout/);
  clock += 299_999;
  await getPopularStories();
  assert.equal(queries.filter((sql) => sql.includes("JOIN public.hacker_news_threads")).length, 1);
  clock += 2;
  await getPopularStories();
  assert.equal(queries.filter((sql) => sql.includes("JOIN public.hacker_news_threads")).length, 2);
});

test("real popularity outages are sanitized errors so the sidebar can distinguish unavailable from empty", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    failure = Object.assign(new Error("private-password"), { code: "08006" });
    await assert.rejects(getPopularStories(), /Hacksnap data is temporarily unavailable/);
    assert.ok(!JSON.stringify(log.mock.calls).includes("private-password"));
    failure = undefined;
    assert.deepEqual(await getPopularStories(), [story], "failed loads do not remain cached");
  } finally {
    log.mockRestore();
  }
});
