import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, jest, test } from "@jest/globals";
import { archiveMonthsSQL } from "../lib/archive.ts";
import { browseCapabilitiesSQL } from "../lib/browse-capabilities.ts";
import { categoryCountsSQL } from "../lib/categories.ts";
import { storySlugColumnSQL } from "../lib/story-slug-projection.ts";

const queries = [];
const poolWaits = [];
let connectionTail = Promise.resolve();
let holdListings;
let failArchive = false;
let queryDelayMs = 0;
const card = { hn_id: "123", title: "Fixture story", date_added: new Date("2026-09-01") };

function kind(sql) {
  if (sql === archiveMonthsSQL) return "months";
  if (sql === categoryCountsSQL) return "counts";
  if (sql === browseCapabilitiesSQL) return "capabilities";
  if (sql === storySlugColumnSQL) return "slug";
  if (sql.includes("AS takeaway")) return "related";
  if (sql.includes("WHERE t.category = $1")) return "category";
  if (sql.includes("INNER JOIN hacksnap_summaries")) return "archive";
  return "transaction";
}

jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    async connect() {
      const requestedAt = performance.now();
      let release;
      const occupied = new Promise((resolve) => {
        release = resolve;
      });
      const previous = connectionTail;
      connectionTail = occupied;
      await previous;
      poolWaits.push(performance.now() - requestedAt);
      return {
        async query(statement) {
          const sql = typeof statement === "string" ? statement : statement.text;
          const queryKind = kind(sql);
          queries.push(queryKind);
          if (queryKind === "capabilities")
            return {
              rows: [{ discussion_available: true, images_available: true, slug_available: true }],
            };
          if (queryKind === "slug") return { rows: [{ available: true }] };
          if (queryKind === "months") return { rows: [{ month: "2026-09", count: 1 }] };
          if (queryKind === "counts") return { rows: [{ category: "agents_coding", count: 1 }] };
          if (["archive", "category", "related"].includes(queryKind)) {
            if (holdListings) await holdListings;
            if (queryDelayMs) await new Promise((resolve) => setTimeout(resolve, queryDelayMs));
            if (queryKind === "archive" && failArchive) {
              failArchive = false;
              throw Object.assign(new Error("private fixture diagnostic"), { code: "08006" });
            }
            return { rows: [card] };
          }
          return { rows: [] };
        },
        release() {
          release();
        },
      };
    }
    on() {}
  },
}));

let clock = Date.now();
const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
const data = await import("../lib/data.ts");
process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/fixture";

beforeEach(() => {
  clock += 300_001;
  queries.length = 0;
  poolWaits.length = 0;
  failArchive = false;
  holdListings = undefined;
  queryDelayMs = 0;
});
afterAll(() => {
  now.mockRestore();
  delete process.env.HACKSNAP_WEB_DATABASE_URL;
});

test("browse paths coalesce identical keys, hard-expire, and use one capability round trip", async () => {
  const loaders = [
    ["months", () => data.getArchiveMonths()],
    ["counts", () => data.getCategoryCounts()],
    ["archive", () => data.getArchiveStories(null, 1)],
    ["category", () => data.getCategoryStories("agents_coding", 1)],
    ["related", () => data.getRelatedStories("agents_coding", "123")],
  ];
  for (const [queryKind, load] of loaders) {
    queries.length = 0;
    const results = await Promise.all([load(), load(), load()]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(queries.filter((name) => name === queryKind).length, 1, queryKind);
    assert.equal(
      queries.filter((name) => name === "capabilities").length,
      ["archive", "category"].includes(queryKind) ? 1 : 0,
    );
    assert.equal(queries.length, ["months", "counts"].includes(queryKind) ? 3 : 4);
    await load();
    assert.equal(queries.filter((name) => name === queryKind).length, 1, "warm hit");
    clock += 300_001;
    await load();
    assert.equal(queries.filter((name) => name === queryKind).length, 2, "hard expiry");
  }
});

test("a shared pending budget rejects excess distinct keys before pool access, then recovers", async () => {
  let releaseListings;
  holdListings = new Promise((resolve) => {
    releaseListings = resolve;
  });
  const work = [
    data.getArchiveStories(null, 1),
    data.getArchiveStories(null, 2),
    data.getArchiveStories("2026-09", 1),
    data.getCategoryStories("agents_coding", 1),
    data.getCategoryStories("models_products", 1),
    data.getRelatedStories("agents_coding", "123"),
    data.getCategoryCounts(),
    data.getArchiveMonths(),
  ];
  await assert.rejects(data.getCategoryStories("agents_coding", 2), {
    name: "DataUnavailableError",
    message: "Hacksnap data is temporarily unavailable",
  });
  assert.ok(poolWaits.length <= 1, "excess key never joins the connection pool");
  releaseListings();
  await Promise.all(work);
  await data.getCategoryStories("agents_coding", 2);
  assert.equal(queries.filter((name) => name === "category").length, 3);
  assert.ok(poolWaits.some((milliseconds) => milliseconds > 0));
});

test("invalid keys fail before cache and pool access; a rejected read is immediately retried", async () => {
  for (const load of [
    () => data.getArchiveStories(null, 101),
    () => data.getArchiveStories("2026-13", 1),
    () => data.getCategoryStories("unknown", 1),
    () => data.getCategoryStories("agents_coding", 0),
    () => data.getRelatedStories("agents_coding", "0"),
  ])
    await assert.rejects(load(), RangeError);
  assert.equal(queries.length, 0);
  assert.equal(poolWaits.length, 0);

  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    failArchive = true;
    const first = await Promise.allSettled([
      data.getArchiveStories(null, 1),
      data.getArchiveStories(null, 1),
    ]);
    assert.ok(first.every((result) => result.status === "rejected"));
    assert.equal(queries.filter((name) => name === "archive").length, 1);
    await data.getArchiveStories(null, 1);
    assert.equal(queries.filter((name) => name === "archive").length, 2);
    assert.doesNotMatch(JSON.stringify(log.mock.calls), /private fixture diagnostic/);
  } finally {
    log.mockRestore();
  }
});

test("combined capability query requires every reader grant and detects later rollout", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (
        hn_id bigint, story_slug text, image_url text, image_status text,
        image_width int, image_height int, image_mime_type text
      );
      CREATE TABLE hacksnap_summaries (
        discussion_analysis jsonb, discussion_analyzed_at timestamptz,
        discussion_analysis_coverage jsonb
      );
      GRANT USAGE ON SCHEMA public TO hacksnap_reader;
      GRANT SELECT (hn_id, image_url, image_status, image_width, image_height)
        ON hacker_news_threads TO hacksnap_reader;
      GRANT SELECT (discussion_analysis, discussion_analyzed_at)
        ON hacksnap_summaries TO hacksnap_reader;
      SET ROLE hacksnap_reader;
    `);
    assert.deepEqual((await db.query(browseCapabilitiesSQL)).rows[0], {
      discussion_available: false,
      images_available: false,
      slug_available: false,
    });
    await db.exec(`
      RESET ROLE;
      GRANT SELECT (story_slug, image_mime_type) ON hacker_news_threads TO hacksnap_reader;
      GRANT SELECT (discussion_analysis_coverage) ON hacksnap_summaries TO hacksnap_reader;
      SET ROLE hacksnap_reader;
    `);
    assert.deepEqual((await db.query(browseCapabilitiesSQL)).rows[0], {
      discussion_available: true,
      images_available: true,
      slug_available: true,
    });
  } finally {
    await db.close();
  }
});

test("fixture records queries, cache reuse, coalescing, and one-client pool wait", async () => {
  queryDelayMs = 8;
  const load = () => data.getArchiveStories(null, 11);
  await Promise.all(Array.from({ length: 8 }, load));
  const coldQueries = queries.length;
  const coldConnections = poolWaits.length;
  await Promise.all(Array.from({ length: 8 }, load));
  const warmQueries = queries.length - coldQueries;
  const distinctStart = performance.now();
  await Promise.all([12, 13, 14, 15].map((page) => data.getArchiveStories(null, page)));
  const distinctElapsedMs = performance.now() - distinctStart;
  const distinctQueries = queries.length - coldQueries - warmQueries;
  const distinctWaits = poolWaits.slice(coldConnections);
  const measurement = {
    cold: { requests: 8, databaseQueries: coldQueries, poolAcquisitions: coldConnections },
    warm: { requests: 8, databaseQueries: warmQueries },
    distinct: {
      requests: 4,
      databaseQueries: distinctQueries,
      poolAcquisitions: distinctWaits.length,
      poolWaitMs: distinctWaits.map((wait) => Number(wait.toFixed(1))),
      elapsedMs: Number(distinctElapsedMs.toFixed(1)),
    },
  };
  console.info("Browse cache fixture measurement", measurement);
  assert.deepEqual(measurement.cold, {
    requests: 8,
    databaseQueries: 4,
    poolAcquisitions: 1,
  });
  assert.deepEqual(measurement.warm, { requests: 8, databaseQueries: 0 });
  assert.equal(distinctQueries, 16);
  assert.equal(distinctWaits.length, 4);
  assert.ok(distinctWaits.slice(1).every((wait) => wait > 0));
});
