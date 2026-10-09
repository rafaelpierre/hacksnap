import assert from "node:assert/strict";
import { afterAll, beforeEach, jest, test } from "@jest/globals";
import { browseCapabilitiesSQL } from "../lib/browse-capabilities.ts";
import { popularityAvailableSQL, weeklyPopularityAvailableSQL } from "../lib/popular-stories.ts";
import { storySlugColumnSQL } from "../lib/story-slug-projection.ts";
import { discussionColumnsSQL, imageColumnsSQL } from "../lib/story-projection.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const pools = [];
const row = { hn_id: "123", title: "Available story", date_added: new Date(), summary: null };
let weeklyStarted;
let releaseWeekly;
let failWeekly;
let clock = Date.now();
const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
const oldURL = process.env.HACKSNAP_WEB_DATABASE_URL;

jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    tail = Promise.resolve();
    statements = [];
    constructor(options) {
      this.options = options;
      pools.push(this);
    }
    on() {}
    async connect() {
      // Model pg's one-connection FIFO queue separately for each pool instance.
      const previous = this.tail;
      const released = deferred();
      this.tail = released.promise;
      await previous;
      return {
        query: async (statement) => {
          const sql = typeof statement === "string" ? statement : statement.text;
          this.statements.push(sql);
          if (sql.includes("WITH recent_views AS")) {
            weeklyStarted.resolve();
            await releaseWeekly.promise;
            if (failWeekly)
              throw Object.assign(new Error("private weekly timeout"), { code: "57014" });
            return { rows: [row] };
          }
          if (sql === browseCapabilitiesSQL)
            return {
              rows: [{ discussion_available: true, images_available: true, slug_available: true }],
            };
          if (
            [
              popularityAvailableSQL,
              weeklyPopularityAvailableSQL,
              storySlugColumnSQL,
              discussionColumnsSQL,
              imageColumnsSQL,
            ].includes(sql)
          )
            return { rows: [{ available: true }] };
          return { rows: [row] };
        },
        release: () => released.resolve(),
      };
    }
  },
}));
const { getPopularStories, getStory, getArchiveStories } = await import("../lib/data.ts");

beforeEach(() => {
  clock += 1_800_001;
  pools.length = 0;
  delete globalThis.hacksnapPool;
  delete globalThis.hacksnapTrendingPool;
  weeklyStarted = deferred();
  releaseWeekly = deferred();
  process.env.HACKSNAP_WEB_DATABASE_URL =
    "postgresql://hacksnap_reader.project@aws.pooler.supabase.com/test";
});
afterAll(() => {
  now.mockRestore();
  if (oldURL === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
  else process.env.HACKSNAP_WEB_DATABASE_URL = oldURL;
  delete globalThis.hacksnapPool;
  delete globalThis.hacksnapTrendingPool;
});

test.each([false, true])(
  "concurrent article, feed and lifetime reads finish while weekly aggregate stalls (timeout=%s)",
  async (timeout) => {
    failWeekly = timeout;
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    // Multiple requests share the one pending weekly aggregate.
    const weekly = Promise.allSettled([
      getPopularStories("last-7-days"),
      getPopularStories("last-7-days"),
    ]);
    await weeklyStarted.promise;
    let requiredFinished = false;
    const required = Promise.all([
      getStory("123"),
      getArchiveStories(null, 1),
      getPopularStories("all-time"),
    ]).then((results) => {
      requiredFinished = true;
      return results;
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requiredFinished, true, "another request must not queue behind Trending");
      const [article, feed, lifetime] = await required;
      assert.equal(article.hn_id, "123");
      assert.equal(feed.stories[0].hn_id, "123");
      assert.equal(lifetime[0].hn_id, "123");
      assert.equal(pools.length, 2);
      for (const { options } of pools) {
        assert.equal(options.max, 1);
        assert.equal(options.connectionTimeoutMillis, 10000);
        assert.equal(options.idleTimeoutMillis, 90000);
        const url = new URL(options.connectionString);
        assert.equal(url.username, "hacksnap_reader.project");
        assert.equal(url.searchParams.get("sslmode"), "verify-full");
        assert.match(url.searchParams.get("sslrootcert"), /supabase-ca\.crt$/);
      }
      assert.equal(
        pools[0].statements.filter((sql) => sql.includes("WITH recent_views AS")).length,
        1,
      );
      assert.match(pools[0].statements[0], /READ ONLY; SET LOCAL statement_timeout = '10s'/);
    } finally {
      releaseWeekly.resolve();
      await required;
      const outcomes = await weekly;
      log.mockRestore();
      for (const outcome of outcomes) {
        assert.equal(outcome.status, timeout ? "rejected" : "fulfilled");
        if (timeout)
          assert.match(outcome.reason.message, /^Hacksnap data is temporarily unavailable/);
      }
    }
    assert.ok(pools[0].statements.includes(timeout ? "ROLLBACK" : "COMMIT"));
    await pools[0].tail;
  },
);
