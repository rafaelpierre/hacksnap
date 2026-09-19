import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chartPoints, rankPath, rankHistorySQL } from "../lib/rank-history.ts";

test("history query isolates stories, bounds payloads and returns chronological ranks", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacksnap_rank_history (
      hn_id bigint, observed_at timestamptz, rank bigint);
      INSERT INTO hacksnap_rank_history
      SELECT 1, '2026-09-01'::timestamptz + n * interval '1 hour', n * 2
      FROM generate_series(1, 170) n;
      INSERT INTO hacksnap_rank_history VALUES (2, '2026-09-10', 999);`);
    const {rows} = await db.query(`SELECT t.hn_id, ${rankHistorySQL} AS history
      FROM (VALUES (1), (2), (3)) t(hn_id) ORDER BY t.hn_id`);
    assert.equal(rows[0].history.length, 168);
    assert.equal(rows[0].history[0].rank, 6);
    assert.equal(rows[0].history.at(-1).rank, 340);
    assert.ok(rows[0].history.every((p, i, all) => !i || Date.parse(p.observed_at) > Date.parse(all[i-1].observed_at)));
    assert.equal(rows[1].history.length, 1);
    assert.equal(rows[1].history[0].rank, 999);
    assert.deepEqual(rows[2].history, []);
  } finally { await db.close(); }
});

test("rank chart preserves every observation and places better positions higher", () => {
  const observation = (hour, rank) => ({observed_at: `2026-09-18T${String(hour).padStart(2, "0")}:00:00Z`, rank});
  assert.deepEqual(chartPoints([]), []);
  assert.deepEqual(chartPoints([observation(1, 1)]).map(({x,y}) => [x,y]), [[80,30]]);
  assert.ok(chartPoints([observation(1, 10), observation(2, 10)]).every(p => p.y === 30));
  const points = chartPoints([observation(1, 20), observation(2, 1), observation(5, 20)]);
  assert.deepEqual(points.map(p => p.x), [6,43,154]);
  assert.deepEqual(points.map(p => p.y), [54,6,54]);
  assert.equal(rankPath(points), "M6,54 L43,6 L154,54");
  assert.equal(rankPath([]), "");
  assert.equal(rankPath([{x:80,y:30}]), "M80,30");
});
