import assert from "node:assert/strict";
import { publicStorySQL } from "../lib/public-story.ts";
import { PGlite } from "@electric-sql/pglite";
import { hasReadySummary } from "../lib/ready-stories.ts";
import { ReadyStoryPageError } from "../lib/ready-story-pagination-errors.ts";
import { beforeEach, afterAll, expect, jest, test } from "@jest/globals";
import {
  feedFields,
  feedFieldsWithoutImages,
  storyFields,
  storyFieldsWithoutImages,
  legacyFeedFields,
  legacyStoryFields,
  discussionColumnsSQL,
  imageColumnsSQL,
} from "../lib/story-projection.ts";

const queries = [];
const queryValues = [];
let rows = [];
let readyQuery;
let available = true;
let imagesAvailable = true;
let connectionError;
let queryError;
let rollbackError;
const releases = [];
const client = {
  query: async (sql, values) => {
    queries.push(typeof sql === "string" ? sql : sql.text);
    queryValues.push(values);
    if (sql === "ROLLBACK" && rollbackError) throw rollbackError;
    if (sql !== "ROLLBACK" && queryError) throw queryError;
    if (sql === discussionColumnsSQL) return { rows: [{ available }] };
    if (sql === imageColumnsSQL) return { rows: [{ available: imagesAvailable }] };
    const response = readyQuery?.(sql, values);
    if (response) return response;
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
let clock = Date.now();
const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
beforeEach(() => {
  clock += 1_800_001;
  readyQuery = undefined;
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
    assert.ok(queries.some((sql) => sql.includes("t.image_url, t.image_status")));
    assert.ok(queries.every((sql) => !sql.includes("image_source_")));

    rows = [
      { items: [], stories: [], ingestion: null, ranked_at: new Date("2026-09-27T12:00:00Z") },
    ];
    queries.length = 0;
    await data.getLeaderboard();
    assert.ok(queries.some((sql) => sql.includes(feedFields)));

    clock += 60_000;
    rows = [
      {
        items: [{ hn_id: "123", rank: "1", is_recent: true }],
        stories: [
          {
            hn_id: "123",
            date_added: "2026-09-27T12:00:00Z",
            rank_history: [],
            summary: { discussion_summary: "Legacy summary" },
          },
        ],
        ingestion: null,
        ranked_at: new Date("2026-09-27T12:00:00Z"),
      },
    ];
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
        rows = [{ items: [], stories: [], ingestion: null, ranked_at: new Date() }];
        queries.length = 0;
        await load();
        assert.ok(queries.includes(discussionColumnsSQL));
        assert.ok(queries.includes(imageColumnsSQL));
        assert.ok(queries.some((sql) => sql.includes(fields)));
      }
    }
  } finally {
    available = true;
    imagesAvailable = true;
    rows = [];
    warning.mockRestore();
  }
});

test("story loaders omit unavailable image columns and pick them up after reader grants", async () => {
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const ready of [false, true]) {
      clock += 1_800_001;
      imagesAvailable = ready;
      rows = [{ items: [], stories: [], ingestion: null, ranked_at: new Date() }];
      queries.length = 0;
      await data.getStory("789");
      assert.ok(queries.includes(imageColumnsSQL));
      assert.ok(
        queries.some((sql) => sql.includes(ready ? storyFields : storyFieldsWithoutImages)),
      );
      assert.ok(!queries.some((sql) => sql.includes("image_source_url")));
    }
  } finally {
    imagesAvailable = true;
    rows = [];
    warning.mockRestore();
  }
});

test("image reads fall back to null projections until every reader grant is available", async () => {
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  try {
    imagesAvailable = false;
    for (const [load, fields] of [
      [() => data.getFeedStories(), feedFieldsWithoutImages],
      [() => data.getArchiveStories(null, 1), feedFieldsWithoutImages],
      [() => data.getCategoryStories("agents_coding", 1), feedFieldsWithoutImages],
      [() => data.getStory("987"), storyFieldsWithoutImages],
      [() => data.getLeaderboard(), feedFieldsWithoutImages],
      [() => data.getPublicStory("987"), publicStorySQL(true, false)],
    ]) {
      queries.length = 0;
      rows = [{ items: [], stories: [], ingestion: null, ranked_at: new Date() }];
      await load();
      assert.ok(queries.includes(imageColumnsSQL));
      assert.ok(queries.some((sql) => sql.includes(fields)));
      assert.ok(queries.every((sql) => !sql.includes("image_source_")));
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
      rows = [{ items: [], stories: [], ingestion: null, ranked_at: new Date() }];
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
      rows = [{ items: [], stories: [], ingestion: null, ranked_at: new Date() }];
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

test("ready selection captures the first ten atomically and hydrates only requested continuation", async () => {
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
        SELECT *, true AS is_recent, row_number() OVER (ORDER BY points DESC, hn_id DESC) AS rank
        FROM hacker_news_threads;
      CREATE TABLE hacksnap_summaries (
        story_id bigint PRIMARY KEY, article_summary text, article_key_points jsonb,
        discussion_summary text, discussion_points jsonb, sentiment int,
        overall_takeaway text, generated_at timestamptz, model text, source_coverage jsonb,
        discussion_analysis jsonb, discussion_analyzed_at timestamptz,
        discussion_analysis_coverage jsonb
      );
      CREATE TABLE hacksnap_rank_history (hn_id bigint, rank bigint, observed_at timestamptz);
      CREATE TABLE hn_ingestion_runs (run_id bigint, status text, filters jsonb, started_at timestamptz, finished_at timestamptz);
      INSERT INTO hacker_news_threads (hn_id, points, date_added)
        SELECT id, 100 - id, CURRENT_TIMESTAMP FROM generate_series(1, 14) AS id;
      INSERT INTO hacksnap_summaries (story_id, overall_takeaway)
        SELECT id, CASE WHEN id <= 3 THEN ' ' ELSE 'Ready' END FROM generate_series(1, 14) AS id;
    `);
    const selection = [...Array(11)].map((_, index) => ({
      hn_id: String(index + 4),
      rank: String(index + 4),
      is_recent: true,
    }));
    readyQuery = (sql, values) => {
      if (
        typeof sql === "string" &&
        (sql.includes("json_agg(item ORDER BY item.rank)") ||
          sql.includes("FROM unnest($1::bigint[]"))
      )
        return db.query(sql, values);
    };
    rows = [];
    queries.length = 0;
    queryValues.length = 0;
    const page = await data.getReadyStoryPage();
    assert.deepEqual(
      page.stories.map((story) => story.hn_id),
      selection.slice(0, 10).map((x) => x.hn_id),
    );
    assert.deepEqual(
      page.stories.map((story) => story.rank),
      selection.slice(0, 10).map((item) => item.rank),
    );
    const selectionSQL = queries.find((sql) => sql.includes("json_agg(item ORDER BY item.rank)"));
    assert.ok(
      !queries.some((sql) => sql.includes("FROM unnest($1::bigint[]")),
      "the first ten cards are in the selection read, not a separate hydration",
    );
    const next = await data.getReadyStoryPage({ cursor: page.pagination.cursor });
    assert.deepEqual(
      next.stories.map((story) => String(story.hn_id)),
      ["14"],
    );
    const pageIndex = queries.findIndex((sql) => sql.includes("FROM unnest($1::bigint[]"));
    assert.match(selectionSQL, /WHERE s\.overall_takeaway ~ '\[\^\[:space:\]\]'/);
    assert.match(selectionSQL, /LIMIT 401/);
    const selected = (await db.query(selectionSQL)).rows[0].items;
    assert.deepEqual(
      selected.map((item) => item.hn_id),
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    );
    const hydrated = await db.query(queries[pageIndex], queryValues[pageIndex]);
    assert.equal(hydrated.rows.length, 1);
    assert.ok(hydrated.rows.every((story) => story.snapshot_ready));
  } finally {
    readyQuery = undefined;
    rows = [];
    warning.mockRestore();
    await db.close();
  }
}, 30000);

test("ready-story pages freeze traversal membership and make all end states explicit", async () => {
  const ranked = (count) =>
    Array.from({ length: count }, (_, index) => ({
      hn_id: String(1000 - index),
      rank: String(index + 1),
      is_recent: index < 8,
    }));
  let selection = ranked(12);
  let unavailable = new Set();
  let missing = new Set();
  let hydrationReads = 0;
  readyQuery = (sql, values) => {
    if (typeof sql !== "string") return undefined;
    if (sql.includes("json_agg(story ORDER BY story.rank)"))
      return {
        rows: [
          {
            items: selection,
            stories: selection.slice(0, 10).map((item) => ({
              ...item,
              date_added: new Date(clock).toISOString(),
              rank_history: [],
              summary: { overall_takeaway: "Ready" },
            })),
            ingestion: null,
            ranked_at: new Date(clock),
          },
        ],
      };
    if (sql.includes("FROM unnest($1::bigint[]")) {
      hydrationReads++;
      return {
        rows: values[0]
          .map((hn_id, index) => ({
            hn_id,
            title: `Story ${hn_id}`,
            url: `https://example.com/${hn_id}`,
            points: 100,
            comment_count: 1,
            date_added: new Date(clock),
            rank: values[1][index],
            is_recent: values[2][index],
            rank_history: [],
            summary: { overall_takeaway: "Ready" },
            snapshot_ready: !unavailable.has(hn_id),
          }))
          .filter((story) => !missing.has(story.hn_id)),
      };
    }
  };
  try {
    rows = [];
    queries.length = 0;
    const leaderboard = await data.getLeaderboard();
    const first = await data.getReadyStoryPage();
    assert.deepEqual(
      first.stories.map((story) => story.hn_id),
      selection.slice(0, 10).map((x) => x.hn_id),
    );
    assert.deepEqual(
      first.stories.map((story) => story.hn_id),
      leaderboard.stories.map((story) => story.hn_id),
      "the first ready page preserves the existing first-batch selection",
    );
    assert.equal(first.pagination.hasMore, true);
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.selectionLimited, false);

    // New rows, rank churn and recency aging cannot alter an established cursor.
    selection = [
      { hn_id: "2000", rank: "1", is_recent: true },
      ...ranked(11).map((item) => ({ ...item, is_recent: false })),
    ];
    const second = await data.getReadyStoryPage({ cursor: first.pagination.cursor });
    assert.deepEqual(
      second.stories.map((story) => story.hn_id),
      ["990", "989"],
    );
    assert.deepEqual(
      second.stories.map((story) => story.rank),
      ["11", "12"],
    );
    assert.deepEqual(
      second.stories.map((story) => story.is_recent),
      [false, false],
    );
    assert.equal(second.pagination.hasMore, false);
    assert.equal(second.pagination.cursor, null);
    assert.ok(second.pagination.previousCursor);
    const readsAfterSecond = hydrationReads;
    const repeated = await data.getReadyStoryPage({ cursor: first.pagination.cursor });
    assert.deepEqual(repeated.stories, second.stories);
    assert.equal(hydrationReads, readsAfterSecond, "repeat uses the bounded page cache");

    clock += 60_001;
    selection = [];
    const empty = await data.getReadyStoryPage();
    assert.deepEqual(empty.stories, []);
    assert.equal(empty.pagination.hasMore, false);

    clock += 60_001;
    selection = ranked(401);
    const capped = await data.getReadyStoryPage();
    assert.equal(capped.pagination.selectionLimited, true);
    assert.equal(capped.pagination.hasMore, true);

    clock += 60_001;
    selection = ranked(11);
    const invalidatedFirst = await data.getReadyStoryPage();
    unavailable = new Set(["990"]);
    await assert.rejects(
      data.getReadyStoryPage({ cursor: invalidatedFirst.pagination.cursor }),
      (error) => error instanceof ReadyStoryPageError && error.code === "snapshot_invalidated",
    );

    clock += 60_001;
    unavailable = new Set();
    missing = new Set(["990"]);
    const missingFirst = await data.getReadyStoryPage();
    await assert.rejects(
      data.getReadyStoryPage({ cursor: missingFirst.pagination.cursor }),
      (error) => error instanceof ReadyStoryPageError && error.code === "snapshot_invalidated",
    );
  } finally {
    readyQuery = undefined;
    rows = [];
  }
});

test("leaderboard coalesces reads and hard-expires ranks, scores and ingestion after one minute", async () => {
  const previousURL = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const snapshot = (id, points, time) => ({
    items: [{ hn_id: id, rank: "1", is_recent: true }],
    stories: [{ hn_id: id, rank: "1", points, date_added: time, rank_history: [] }],
    ingestion: new Date(time),
    ranked_at: new Date(time),
  });
  const reads = () => queries.filter((sql) => sql.includes("AS ranked_at")).length;
  try {
    queries.length = 0;
    rows = [snapshot("123", 160, "2026-09-29T17:00:00Z")];
    const initial = await Promise.all([data.getLeaderboard(), data.getLeaderboard()]);
    assert.equal(reads(), 1, "concurrent callers share one database read");
    assert.deepEqual(initial[0], initial[1]);
    rows = [snapshot("456", 177, "2026-09-29T17:01:00Z")];
    clock += 59_999;
    assert.equal((await data.getLeaderboard()).stories[0].hn_id, "123");
    assert.equal(reads(), 1);
    clock += 1;
    const fresh = await data.getLeaderboard();
    assert.equal(reads(), 2);
    assert.equal(fresh.stories[0].hn_id, "456", "expired ordering is replaced in this response");
    assert.equal(fresh.stories[0].points, 177);
    assert.equal(fresh.ingestion.toISOString(), "2026-09-29T17:01:00.000Z");
    assert.equal(fresh.observed_at, "2026-09-29T17:01:00.000Z");
    clock += 60_000;
    queryError = new Error("database unavailable");
    await assert.rejects(data.getLeaderboard(), /Hacksnap data is temporarily unavailable/);
    queryError = undefined;
    rows = [snapshot("789", 200, "2026-09-29T17:02:00Z")];
    assert.equal(
      (await data.getLeaderboard()).stories[0].hn_id,
      "789",
      "a failed refresh is retried immediately",
    );
  } finally {
    queryError = undefined;
    rows = [];
    log.mockRestore();
    if (previousURL === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previousURL;
  }
});

test("HTML and legacy formats share one selection regardless of warm-up order and refresh together", async () => {
  const previousURL = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const snapshot = (base, time) => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      hn_id: String(base + index),
      rank: String(index + 1),
      is_recent: base === 100,
    }));
    return {
      items,
      stories: items.slice(0, 10).map((item) => ({
        ...item,
        points: base,
        date_added: time,
        rank_history: [],
        summary: { overall_takeaway: `Snapshot ${base}` },
      })),
      ingestion: new Date(time),
      ranked_at: new Date(time),
    };
  };
  const firstPage = () => data.getReadyStoryPage();
  const legacy = () => data.getLeaderboard();
  const withoutPagination = ({ stories, ingestion, observed_at }) => ({
    stories,
    ingestion,
    observed_at,
  });
  const reads = () => queries.filter((sql) => sql.includes("AS ranked_at")).length;
  try {
    for (const [warm, later] of [
      [legacy, firstPage],
      [firstPage, legacy],
    ]) {
      clock += 60_001;
      queries.length = 0;
      rows = [snapshot(100, "2026-09-29T17:00:00Z")];
      const initial = await warm();
      // Rankings, card metadata, recency flags and ingestion change before the
      // other format gets its first request in this cache generation.
      rows = [snapshot(200, "2026-09-29T17:01:00Z")];
      clock += 59_999;
      assert.deepEqual(withoutPagination(await later()), withoutPagination(initial));
      assert.equal(reads(), 1);
      assert.ok(!queries.some((sql) => sql.includes("FROM unnest($1::bigint[]")));
      clock += 1;
      const [html, api] = await Promise.all([firstPage(), legacy()]);
      assert.equal(reads(), 2, "one coalesced refresh for both formats at hard expiry");
      assert.deepEqual(withoutPagination(html), api);
      assert.deepEqual(
        html.stories.map((story) => story.hn_id),
        rows[0].items.slice(0, 10).map((item) => item.hn_id),
      );
      assert.equal(html.stories[0].points, 200);
      assert.equal(html.stories[0].is_recent, false);
      assert.equal(html.ingestion.toISOString(), "2026-09-29T17:01:00.000Z");
      assert.equal(html.observed_at, "2026-09-29T17:01:00.000Z");
    }
  } finally {
    rows = [];
    if (previousURL === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previousURL;
  }
});

test("ready API cursors retain page size through forward and backward traversal", async () => {
  const { readyStoriesHandler } = await import("../lib/stories-api.ts");
  const handle = readyStoriesHandler(data);
  const selection = Array.from({ length: 12 }, (_, index) => ({
    hn_id: String(index + 1),
    rank: String(index + 1),
    is_recent: true,
  }));
  const card = (item) => ({
    ...item,
    title: `Story ${item.hn_id}`,
    url: "https://example.com/story",
    points: 10,
    comment_count: 2,
    date_added: new Date(clock),
    rank_history: [],
    summary: { overall_takeaway: "Ready", sentiment: 0 },
  });
  readyQuery = (sql, values) => {
    if (typeof sql !== "string") return;
    if (sql.includes("AS ranked_at"))
      return {
        rows: [
          {
            items: selection,
            stories: selection
              .slice(0, 10)
              .map((item) => ({ ...card(item), date_added: new Date(clock).toISOString() })),
            ingestion: new Date(clock),
            ranked_at: new Date(clock),
          },
        ],
      };
    if (sql.includes("FROM unnest($1::bigint[]"))
      return {
        rows: values[0].map((id, index) => ({
          ...card({ hn_id: id, rank: values[1][index], is_recent: values[2][index] }),
          snapshot_ready: true,
        })),
      };
  };
  const request = (params) =>
    handle(new Request(`https://hacksnap.live/api/ready-stories?${new URLSearchParams(params)}`));
  const ok = async (params) => {
    const response = await request(params);
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    for (const size of [1, 5, 10]) {
      clock += 60_001;
      const pages = [await ok({ pageSize: String(size) })];
      while (pages.at(-1).pagination.cursor) {
        // The documented client flow returns only the opaque cursor.
        pages.push(await ok({ cursor: pages.at(-1).pagination.cursor }));
      }
      assert.equal(pages.length, Math.ceil(selection.length / size));
      assert.deepEqual(
        pages.flatMap((page) => page.stories.map((story) => story.hn_id)),
        selection.map((item) => item.hn_id),
      );
      for (const [index, page] of pages.entries()) {
        assert.equal(page.pagination.page, index + 1);
        assert.equal(page.stories.length, Math.min(size, selection.length - index * size));
        assert.equal(Boolean(page.pagination.previousCursor), index > 0);
        assert.equal(
          Math.floor(Date.parse(page.pagination.expiresAt) / 1000),
          Math.floor(Date.parse(pages[0].pagination.expiresAt) / 1000),
        );
      }
      let backward = pages.at(-1);
      for (let index = pages.length - 2; index >= 0; index--) {
        backward = await ok({ cursor: backward.pagination.previousCursor });
        assert.equal(backward.pagination.page, index + 1);
        assert.deepEqual(
          backward.stories.map((story) => story.hn_id),
          pages[index].stories.map((story) => story.hn_id),
        );
      }
      assert.equal(backward.pagination.previousCursor, null);
      const cursor = pages[0].pagination.cursor;
      const sameSize = await ok({ cursor, pageSize: String(size) });
      assert.deepEqual(sameSize, pages[1]);
      for (const mismatch of [size === 10 ? 5 : 10, 0, 11]) {
        queries.length = 0;
        const rejected = await request({ cursor, pageSize: String(mismatch) });
        assert.equal(rejected.status, 400);
        assert.equal((await rejected.json()).code, "invalid_page_size");
        assert.equal(queries.length, 0, "mismatched sizes fail before a database read");
      }
    }
  } finally {
    readyQuery = undefined;
    rows = [];
  }
});
