import assert from "node:assert/strict";
import { publicStorySQL } from "../lib/public-story.ts";
import { PGlite } from "@electric-sql/pglite";
import { hasReadySummary } from "../lib/ready-stories.ts";
import { beforeEach, afterAll, expect, jest, test } from "@jest/globals";
import {
  feedFields,
  storyFields,
  legacyFeedFields,
  legacyStoryFields,
  discussionColumnsSQL,
  imageColumnsSQL,
  storyImageProjection,
} from "../lib/story-projection.ts";

const queries = [];
let rows = [];
let available = true;
let imagesAvailable = true;
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
    if (sql === imageColumnsSQL) return { rows: [{ available: imagesAvailable }] };
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
    assert.deepEqual(keys, ["hacksnap-leaderboard-v15-public-images", "enabled"]);
    return () => cachedValue ?? fn();
  },
}));
let clock = Date.now();
const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
beforeEach(() => {
  clock += 1_800_001;
});
afterAll(() => now.mockRestore());
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
    queries.length = 0;
    for (const page of [0, 101, 9999999, NaN, 1.5]) {
      await assert.rejects(data.getArchiveStories(null, page), /Invalid browse page/);
      await assert.rejects(data.getCategoryStories("agents_coding", page), /Invalid browse page/);
    }
    assert.equal(queries.length, 0, "invalid pages never acquire a database connection");
    rows = Array.from({ length: 31 }, () => ({ hn_id: "1" }));
    assert.equal((await data.getArchiveStories(null, 100)).hasNext, false);
    assert.equal((await data.getCategoryStories("agents_coding", 100)).hasNext, false);
  } finally {
    cachedValue = undefined;
    rows = [];
    if (previousURL === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previousURL;
  }
});

test("all story loaders tolerate an unmigrated database and detect migration on the next uncached read", async () => {
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const ready of [false, true]) {
      clock += 1_800_001;
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

test("image reads fall back to null projection until every reader grant is available", async () => {
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  try {
    imagesAvailable = false;
    for (const load of [
      () => data.getFeedStories(),
      () => data.getArchiveStories(null, 1),
      () => data.getCategoryStories("agents_coding", 1),
      () => data.getStory("987"),
      () => data.getLeaderboard(),
      () => data.getPublicStory("987"),
    ]) {
      queries.length = 0;
      rows = [{ stories: [], ingestion: null, ranked_at: new Date() }];
      await load();
      assert.ok(queries.includes(imageColumnsSQL));
      assert.ok(queries.some((sql) => sql.includes(storyImageProjection(false))));
      assert.ok(queries.every((sql) => !sql.includes("public_image.image_url")));
    }
  } finally {
    imagesAvailable = true;
    rows = [];
    delete process.env.HACKSNAP_WEB_DATABASE_URL;
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

test("leaderboard fills ten preview-ready stories before limiting, including older fallbacks", async () => {
  const db = new PGlite();
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await db.exec(`
      CREATE TABLE hacker_news_threads (
        hn_id bigint PRIMARY KEY, title text, url text, points int,
        comment_count int, date_added timestamptz, category text,
        image_url text, image_status text, image_width int, image_height int, image_mime_type text
      );
      CREATE VIEW hacksnap_ranked_stories AS
        SELECT *, date_added >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AS is_recent,
          row_number() OVER (ORDER BY
            (date_added >= CURRENT_TIMESTAMP - INTERVAL '24 hours') DESC,
            points DESC, hn_id DESC) AS rank
        FROM hacker_news_threads;
      CREATE VIEW hacksnap_current_stories AS
        SELECT * FROM hacksnap_ranked_stories ORDER BY rank LIMIT 10;
      CREATE TABLE hacksnap_summaries (
        story_id bigint PRIMARY KEY, article_summary text, article_key_points jsonb,
        discussion_summary text, discussion_points jsonb, sentiment int,
        overall_takeaway text, generated_at timestamptz, model text, source_coverage jsonb,
        discussion_analysis jsonb, discussion_analyzed_at timestamptz,
        discussion_analysis_coverage jsonb
      );
      CREATE TABLE hacksnap_rank_history (hn_id bigint, rank bigint, observed_at timestamptz);
      CREATE TABLE hn_ingestion_runs (
        run_id bigint, status text, filters jsonb, started_at timestamptz, finished_at timestamptz
      );
      INSERT INTO hacker_news_threads (hn_id, points, date_added)
        SELECT id, CASE WHEN id <= 8 THEN 100 ELSE 1000 END,
          CURRENT_TIMESTAMP - CASE WHEN id <= 8 THEN INTERVAL '1 hour' ELSE INTERVAL '2 days' END
        FROM generate_series(1, 20) AS id;
      INSERT INTO hacksnap_summaries (story_id, overall_takeaway)
        SELECT hn_id, CASE hn_id WHEN 7 THEN NULL WHEN 6 THEN '' WHEN 5 THEN E' \t\n\r '
          ELSE 'Ready preview' END
        FROM hacker_news_threads WHERE hn_id <> 8;
    `);
    for (const ready of [false, true]) {
      clock += 1_800_001;
      available = ready;
      rows = [{ stories: [], ingestion: null, ranked_at: new Date() }];
      queries.length = 0;
      await data.getLeaderboard();
      const sql = queries.find((query) => query.includes("json_agg(story ORDER BY story.rank)"));
      const result = await db.query(sql);
      const stories = result.rows[0].stories;
      assert.equal(stories.length, 10);
      assert.ok(stories.every(hasReadySummary));
      assert.deepEqual(
        stories.map((story) => story.hn_id),
        [4, 3, 2, 1, 20, 19, 18, 17, 16, 15],
      );
      assert.deepEqual(
        stories.map((story) => story.is_recent),
        [true, true, true, true, false, false, false, false, false, false],
      );
      // Preserve canonical ranks so current positions and recorded history use the same scale.
      assert.deepEqual(
        stories.map((story) => story.rank),
        [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      );
    }
    const sql = queries.find((query) => query.includes("json_agg(story ORDER BY story.rank)"));
    await db.exec("DELETE FROM hacksnap_summaries WHERE story_id > 2");
    assert.deepEqual(
      (await db.query(sql)).rows[0].stories.map((story) => story.hn_id),
      [2, 1],
    );
    await db.exec("DELETE FROM hacksnap_summaries");
    assert.deepEqual((await db.query(sql)).rows[0].stories, []);
  } finally {
    available = true;
    imagesAvailable = true;
    rows = [];
    warning.mockRestore();
    await db.close();
  }
}, 30000);

test("rendering fallback uses legacy projections without reading or changing stored analysis", async () => {
  const previous = process.env.HACKSNAP_DISCUSSION_RENDERING;
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env.HACKSNAP_DISCUSSION_RENDERING = "false";
  try {
    for (const [load, fields] of [
      [() => data.getFeedStories(), legacyFeedFields],
      [() => data.getArchiveStories(null, 1), legacyFeedFields],
      [() => data.getCategoryStories("agents_coding", 1), legacyFeedFields],
      [() => data.getStory("456"), legacyStoryFields],
      [() => data.getPublicStory("456"), publicStorySQL(false)],
      [() => data.getLeaderboard(), legacyFeedFields],
    ]) {
      rows = [{ stories: [], ingestion: null, ranked_at: new Date() }];
      queries.length = 0;
      await load();
      assert.ok(!queries.includes(discussionColumnsSQL));
      assert.ok(queries.some((sql) => sql.includes(fields)));
      assert.ok(queries.every((sql) => !/INSERT|UPDATE|DELETE/.test(sql)));
    }
    expect(warning).not.toHaveBeenCalled();
    delete process.env.HACKSNAP_DISCUSSION_RENDERING;
    clock += 1_800_001;
    queries.length = 0;
    await data.getStory("456");
    assert.ok(queries.includes(discussionColumnsSQL));
    assert.ok(queries.some((sql) => sql.includes(storyFields)));
  } finally {
    rows = [];
    if (previous === undefined) delete process.env.HACKSNAP_DISCUSSION_RENDERING;
    else process.env.HACKSNAP_DISCUSSION_RENDERING = previous;
    warning.mockRestore();
  }
});
