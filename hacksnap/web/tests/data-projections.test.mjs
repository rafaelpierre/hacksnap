import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { feedFields, storyFields } from "../lib/story-projection.ts";

const queries = [];
let rows = [];
let cachedValue;
const client = {
  query: async (sql) => {
    queries.push(typeof sql === "string" ? sql : sql.text);
    return { rows };
  },
  release() {},
};
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    async connect() {
      return client;
    }
    on() {}
  },
}));
jest.unstable_mockModule("next/cache", () => ({
  unstable_cache: (fn, keys) => {
    assert.deepEqual(keys, ["hacksnap-leaderboard-v11-discussion-preview"]);
    return () => cachedValue ?? fn();
  },
}));
const data = await import("../lib/data.ts");

test("each loader uses its intended projection; older cached fields remain optional", async () => {
  const previousURL = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  try {
    for (const load of [
      () => data.getFeedStories(),
      () => data.getArchiveStories(null, 1),
      () => data.getCategoryStories("agents_coding", 1),
    ]) {
      queries.length = 0;
      await load();
      assert.ok(queries.some((sql) => sql.includes(feedFields)));
      assert.ok(!queries.some((sql) => sql.includes(storyFields)));
    }
    queries.length = 0;
    await data.getStory("123");
    assert.ok(queries.some((sql) => sql.includes(storyFields)));

    rows = [{ stories: [], ingestion: null, ranked_at: new Date("2026-09-27T12:00:00Z") }];
    queries.length = 0;
    await data.getLeaderboard();
    assert.ok(queries.some((sql) => sql.includes(feedFields)));

    cachedValue = {
      stories: [
        {
          hn_id: "123",
          date_added: "2026-09-27T12:00:00Z",
          rank_history: [],
          summary: { discussion_summary: "Legacy summary" },
        },
      ],
      ingestion: null,
      observed_at: "2026-09-27T12:00:00Z",
    };
    const { stories } = await data.getLeaderboard();
    assert.ok(stories[0].date_added instanceof Date);
    assert.equal(stories[0].summary.discussion_summary, "Legacy summary");
    assert.equal(stories[0].summary.discussion_analysis_preview ?? null, null);
    assert.equal(stories[0].summary.discussion_analyzed_at ?? null, null);
  } finally {
    cachedValue = undefined;
    rows = [];
    if (previousURL === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previousURL;
  }
});
