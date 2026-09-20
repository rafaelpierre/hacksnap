import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chartPoints, rankPath, rankHistorySQL, withCurrentRank } from "../lib/rank-history.ts";

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
  assert.deepEqual(chartPoints([observation(1, 1)]).map(({x,y}) => [x,y]), [[80,6]]);
  assert.ok(chartPoints([observation(1, 10), observation(2, 10)]).every(p => p.y === 54));
  const points = chartPoints([observation(1, 20), observation(2, 1), observation(5, 20)]);
  assert.deepEqual(points.map(p => p.x), [6,43,154]);
  assert.deepEqual(points.map(p => p.y), [54,6,54]);
  assert.equal(rankPath(points), "M6,54 H43 V6 H154 V54");
  assert.equal(rankPath([]), "");
  assert.equal(rankPath([{x:80,y:30}]), "M80,30");
});

test("reported story preserves 10 → 10 → 8 and ends at the displayed current rank", () => {
  const history = [
    {observed_at: "2026-09-19T18:34:59.226976+00:00", rank: 10},
    {observed_at: "2026-09-19T20:01:18.891639+00:00", rank: 10},
    {observed_at: "2026-09-20T08:02:21.322669+00:00", rank: 8},
  ];
  const combined = withCurrentRank(history, 9, "2026-09-20T10:57:24Z");
  assert.deepEqual(combined.map(p => p.rank), [10, 10, 8, 9]);
  assert.deepEqual(combined.slice(0, 3), history);
  assert.equal(history.length, 3);
  assert.equal(combined.at(-1).current, true);
  assert.ok(combined.slice(0, 3).every(p => !p.current));
  const points = chartPoints(combined);
  assert.equal(points[0].y, points[1].y);
  assert.ok(points[2].y < points[1].y);
  assert.ok(points[3].y > points[2].y);
  assert.ok(points[1].x - points[0].x < points[2].x - points[1].x);
  assert.equal(points.at(-1).x, 154);
  assert.equal(points.at(-1).rank, 9);
});

test("shared scale preserves rank magnitude across stories, including below the top ten", () => {
  const observation = rank => ({observed_at: "2026-09-20T08:00:00Z", rank});
  const smallMove = chartPoints([observation(10), observation(8)]);
  assert.ok(smallMove[0].y - smallMove[1].y < 11);
  const first = chartPoints([observation(30), observation(8)], 30);
  const second = chartPoints([observation(10), observation(8)], 30);
  assert.equal(first[1].y, second[1].y);
  assert.equal(first[0].y, 54);
});

test("current endpoint also works without history and when the rank has not changed", () => {
  const timestamp = "2026-09-20T08:00:00Z";
  assert.deepEqual(withCurrentRank([], 4, timestamp), [{observed_at: timestamp, rank: 4, current: true}]);
  const same = withCurrentRank([{observed_at: timestamp, rank: 4}], 4, "2026-09-20T10:00:00Z");
  assert.equal(same.length, 2);
  assert.equal(chartPoints(same)[0].y, chartPoints(same)[1].y);
});
