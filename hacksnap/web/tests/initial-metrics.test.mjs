import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { initialMetricsProjection, initialMetricsText } from "../lib/initial-metrics.ts";
test("display metrics use the earliest retained snapshot, survive raw cleanup, and never invent missing counts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY, points int, comment_count int);
      CREATE TABLE hn_thread_snapshots(snapshot_id bigint, hn_id bigint, observed_at timestamptz,
        score int, descendants int, raw_payload jsonb);
      INSERT INTO hacker_news_threads VALUES(1,999,999),(2,888,888);
      INSERT INTO hn_thread_snapshots VALUES(2,1,'2026-10-15',99,98,'{}'),
        (1,1,'2026-10-15',10,11,'{}'),(3,1,'2026-10-16',999,999,'{}');`);
    const query = `SELECT ${initialMetricsProjection(true)} FROM hacker_news_threads t ORDER BY hn_id`;
    const expected = [
      { points: 10, comment_count: 11 },
      { points: null, comment_count: null },
    ];
    assert.deepEqual((await db.query(query)).rows, expected);
    await db.exec(
      "UPDATE hn_thread_snapshots SET raw_payload=NULL; UPDATE hacker_news_threads SET points=10000,comment_count=10000;",
    );
    assert.deepEqual((await db.query(query)).rows, expected);
    assert.equal(initialMetricsText(expected[1]), "");
    assert.equal(initialMetricsText(expected[0]), "10 points · 11 comments");
  } finally {
    await db.close();
  }
});
