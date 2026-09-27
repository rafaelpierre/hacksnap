import assert from "node:assert/strict";
import { expect, jest, test } from "@jest/globals";
import {
  feedFields,
  storyFields,
  legacyFeedFields,
  legacyStoryFields,
  discussionColumnsSQL,
} from "../lib/story-projection.ts";

const queries = [];
let rows = [];
let available = true;
let connectionError;
let queryError;
let rollbackError;
const releases = [];
let cachedValue;
const client = {
  query: async (sql) => {
    queries.push(typeof sql === "string" ? sql : sql.text);
    if (sql === "ROLLBACK" && rollbackError) throw rollbackError;
    if (sql !== "ROLLBACK" && queryError) throw queryError;
    if (sql === discussionColumnsSQL) return { rows: [{ available }] };
    return { rows };
  },
  release(discard) {
    releases.push(discard);
  },
};
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    async connect() {
      if (connectionError) throw connectionError;
      return client;
    }
    on() {}
  },
}));
jest.unstable_mockModule("next/cache", () => ({
  unstable_noStore: () => {},
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

test("all story loaders tolerate an unmigrated database and detect migration on the next read", async () => {
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const ready of [false, true]) {
      available = ready;
      for (const [load, fields] of [
        [() => data.getFeedStories(), ready ? feedFields : legacyFeedFields],
        [() => data.getArchiveStories(null, 1), ready ? feedFields : legacyFeedFields],
        [() => data.getCategoryStories("agents_coding", 1), ready ? feedFields : legacyFeedFields],
        [() => data.getStory("456"), ready ? storyFields : legacyStoryFields],
        [() => data.getLeaderboard(), ready ? feedFields : legacyFeedFields],
      ]) {
        rows = [{ stories: [], ingestion: null, ranked_at: new Date() }];
        queries.length = 0;
        await load();
        assert.ok(queries.includes(discussionColumnsSQL));
        assert.ok(queries.some((sql) => sql.includes(fields)));
      }
    }
  } finally {
    available = true;
    rows = [];
    warning.mockRestore();
  }
});

test("connection, query and rollback failures stay sanitized and release broken clients", async () => {
  const { DataUnavailableError } = await import("../lib/data-availability.ts");
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const secret = Object.assign(new Error("postgres://private-password"), { code: "08006" });
  try {
    for (const phase of ["connect", "query", "rollback"]) {
      connectionError = phase === "connect" ? secret : undefined;
      queryError = phase !== "connect" ? secret : undefined;
      rollbackError = phase === "rollback" ? secret : undefined;
      releases.length = 0;
      await assert.rejects(data.getFeedStories(), (error) => {
        assert.ok(error instanceof DataUnavailableError);
        assert.equal(error.message, "Hacksnap data is temporarily unavailable");
        return true;
      });
      assert.deepEqual(
        releases,
        phase === "connect" ? [] : [phase === "rollback" ? true : undefined],
      );
      expect(log.mock.calls.at(-1)).toEqual(["Hacksnap database read failed", { code: "08006" }]);
    }
    assert.ok(!JSON.stringify(log.mock.calls).includes("private-password"));
  } finally {
    connectionError = queryError = rollbackError = undefined;
    log.mockRestore();
  }
});
