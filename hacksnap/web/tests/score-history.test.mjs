import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chartPoints, smoothPath, scoreHistorySQL } from "../lib/score-history.ts";

test("history query isolates stories, bounds payloads and returns chronological counts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hn_thread_snapshots (
      snapshot_id bigint, hn_id bigint, observed_at timestamptz, score int);
      INSERT INTO hn_thread_snapshots
      SELECT n, 1, '2026-09-01'::timestamptz + n * interval '1 hour', n * 2
      FROM generate_series(1, 170) n;
      INSERT INTO hn_thread_snapshots VALUES (171, 2, '2026-09-10', 999);`);
    const {rows} = await db.query(`SELECT t.hn_id, ${scoreHistorySQL} AS history
      FROM (VALUES (1), (2), (3)) t(hn_id) ORDER BY t.hn_id`);
    assert.equal(rows[0].history.length, 168);
    assert.equal(rows[0].history[0].score, 6);
    assert.equal(rows[0].history.at(-1).score, 340);
    assert.ok(rows[0].history.every((p, i, all) => !i || Date.parse(p.observed_at) > Date.parse(all[i-1].observed_at)));
    assert.equal(rows[1].history.length, 1);
    assert.equal(rows[1].history[0].score, 999);
    assert.deepEqual(rows[2].history, []);
  } finally { await db.close(); }
});

test("smoothed trend preserves endpoints, progresses in time and stays within observed bounds", () => {
  for (const ys of [[54, 15, 6, 5], [54, 54, 6, 6], [54, 6, 30, 10]]) {
    const points = ys.map((y, i) => ({x: [6, 12, 100, 154][i], y}));
    const path = smoothPath(points);
    assert.ok(path.startsWith(`M6,${ys[0]}`));
    const samples = [...path.matchAll(/L([^ ,]+),([^ ]+)/g)].map(m => ({x:Number(m[1]), y:Number(m[2])}));
    assert.equal(samples.length, 64);
    assert.deepEqual(samples.at(-1), points.at(-1));
    samples.forEach((sample, i) => {
      assert.ok(sample.x > (i ? samples[i-1].x : points[0].x));
      assert.ok(sample.y >= Math.min(...ys) && sample.y <= Math.max(...ys));
    });
    if (ys.every((y,i) => !i || y <= ys[i-1])) {
      assert.ok(samples.every((p,i) => !i || p.y <= samples[i-1].y));
    }
  }
  // A sparse corner becomes a broad curve, not a near-linear corner rounding.
  const curve = smoothPath([{x:0,y:50},{x:50,y:0},{x:100,y:0}]);
  assert.ok(curve.includes(" L50,12.5"));
  assert.equal(smoothPath([]), "");
  assert.equal(smoothPath([{x:6,y:54},{x:154,y:6}]), "M6,54 L154,6");
  assert.equal(smoothPath([{x:6,y:54},{x:6,y:20},{x:154,y:6}]), "M6,54 L6,20 L154,6");
});

test("sparkline uses elapsed time and handles empty, single, flat and declining counts", () => {
  const observation = (hour, score) => ({observed_at: `2026-09-18T${String(hour).padStart(2, "0")}:00:00Z`, score});
  assert.deepEqual(chartPoints([]), []);
  assert.deepEqual(chartPoints([observation(1, 0)]).map(({x,y}) => [x,y]), [[80,30]]);
  const flat = chartPoints([observation(1, 10), observation(2, 10)]);
  assert.ok(flat.every(p => p.y === 30));
  const points = chartPoints([observation(1, 5), observation(2, 20), observation(5, 10)]);
  assert.deepEqual(points.map(p => p.x), [6,43,154]);
  assert.equal(points[1].y, 6);
  assert.ok(points[2].y > points[1].y);
});
