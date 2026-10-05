import assert from "node:assert/strict";
import { categoryQuery } from "../lib/categories.ts";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import {
  archiveMonth,
  archivePage,
  archiveURL,
  monthBounds,
  archiveQuery,
  ARCHIVE_PAGE_SIZE,
  MAX_BROWSE_PAGE,
} from "../lib/archive.ts";

test("archive routes reject ambiguous dates and pagination", () => {
  assert.equal(archiveMonth(["2026", "09"]), "2026-09");
  for (const path of [
    [],
    ["2026"],
    ["2026", "13"],
    ["2026", "9"],
    ["2026", "09", "01"],
    ["0000", "01"],
  ])
    assert.equal(archiveMonth(path), null);
  assert.equal(archivePage(undefined), 1);
  assert.equal(archivePage("2"), 2);
  assert.equal(archivePage("100"), MAX_BROWSE_PAGE);
  for (const page of ["0", "-1", "1.5", "01", "10000000", "9999999", "101", ["1", "2"]])
    assert.equal(archivePage(page), null);
  assert.equal(archiveURL("2026-09", 2), "/2026/09?page=2");
  assert.equal(archiveURL(null), "/");
  assert.deepEqual(monthBounds("2026-12"), [
    "2026-12-01T00:00:00.000Z",
    "2027-01-01T00:00:00.000Z",
  ]);
});

test("query builders cap offsets even when called without route validation", () => {
  for (const page of [0, -1, 101, 9999999, Infinity, NaN, 1.5]) {
    assert.throws(() => archiveQuery("t.hn_id", null, page), RangeError);
    assert.throws(() => categoryQuery("t.hn_id", "agents_coding", page), RangeError);
  }
  assert.equal(ARCHIVE_PAGE_SIZE, 15);
  assert.equal(archiveQuery("t.hn_id", null, 1).values.at(-2), 16);
  assert.equal(archiveQuery("t.hn_id", null, 100).values.at(-1), 1485);
  assert.equal(categoryQuery("t.hn_id", "agents_coding", 100).values.at(-1), 1485);
});

test("archive index preserves page boundaries, tie order and UTC month filters", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads (
      hn_id bigint PRIMARY KEY, date_added timestamptz NOT NULL);
      CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, overall_takeaway text);
      INSERT INTO hacker_news_threads
      SELECT g, '2026-10-01T00:00:00Z'::timestamptz
        - (g / 3) * interval '1 hour' FROM generate_series(1, 3300) g;
      INSERT INTO hacksnap_summaries SELECT hn_id, 'Published brief' FROM hacker_news_threads;`);
    const pages = [1, 2, 10, 50, 100];
    const read = async (month) => {
      const result = [];
      for (const page of pages) {
        const query = archiveQuery("t.hn_id", month, page);
        result.push((await db.query(query.text, query.values)).rows.map((row) => row.hn_id));
      }
      return result;
    };
    const beforeLatest = await read(null);
    const beforeMonth = await read("2026-09");
    await db.exec(`CREATE INDEX hn_archive_date_idx ON hacker_news_threads
      (date_added DESC, hn_id DESC);`);
    assert.deepEqual(await read(null), beforeLatest);
    assert.deepEqual(await read("2026-09"), beforeMonth);
    assert.equal(beforeLatest[0].length, 16);
    assert.equal(beforeLatest[1].length, 16);
    assert.equal(beforeLatest[0][15], beforeLatest[1][0]);
    assert.equal(new Set(beforeLatest.flatMap((batch) => batch.slice(0, 15))).size, 75);
  } finally {
    await db.close();
  }
});
