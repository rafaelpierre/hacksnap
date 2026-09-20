import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { activityHistorySQL, activityIntervals, activityChange, activityChart, formatRate } from '../lib/activity-history.ts';
const asOf = '2026-09-20T12:00:00Z';
const sample = (hour, score) => ({observed_at: `2026-09-20T${String(hour).padStart(2, '0')}:00:00Z`, score});

test('rates use elapsed hours, preserve losses, and do not fabricate a page-refresh endpoint', () => {
  const intervals = activityIntervals([sample(1, 20), sample(3, 40), sample(4, 70), sample(6, 60)], asOf);
  assert.deepEqual(intervals.map(p => p.rate), [10, 30, -5]);
  assert.equal(intervals.at(-1).end, Date.parse(sample(6, 60).observed_at));
  assert.equal(activityIntervals([], asOf).length, 0);
  assert.equal(activityIntervals([sample(1, 20)], asOf).length, 0);
});

test('invalid, future, duplicate and out-of-window observations cannot distort rates', () => {
  const intervals = activityIntervals([sample(3, 40), sample(1, 20), sample(1, 20), sample(13, 500),
    {observed_at:'2026-09-18T00:00:00Z',score:0}, {observed_at:'invalid',score:30}, sample(2, NaN)], asOf);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].rate, 10);
});

test('chart uses the full 24h timeline, extends the first value left, includes zero and negative rates', () => {
  const intervals = activityIntervals([sample(1, 20), sample(3, 40), sample(4, 35)], asOf);
  const chart = activityChart(intervals, asOf);
  assert.ok(chart.points[0].x > 6);
  assert.ok(chart.path.startsWith(`M6,${chart.points[0].y} L${chart.points[0].x},${chart.points[0].y}`));
  assert.equal(chart.points.length, intervals.length);
  assert.equal(activityChart([], asOf).path, '');
  assert.ok(chart.points.at(-1).x < 154);
  assert.equal(chart.min, -5);
  assert.equal(chart.max, 10);
  assert.ok(chart.points[0].y < chart.baseline);
  assert.ok(chart.points[1].y > chart.baseline);
  assert.ok(chart.path.includes(' L'));
  assert.ok(!chart.path.includes('H'));
  const single = activityChart(intervals.slice(0,1), asOf);
  assert.equal(single.path, `M6,${single.points[0].y} L${single.points[0].x},${single.points[0].y}`);
  const flat = activityChart(activityIntervals([sample(1,20),sample(2,20)],asOf),asOf);
  assert.equal(flat.points[0].y,flat.baseline);
  assert.equal(formatRate(-0.02),'−<0.1');
  assert.equal(formatRate(0),'0');
});

test('history query isolates stories, filters to last 24h, caps payload and returns chronological metrics', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hn_thread_snapshots(snapshot_id bigint GENERATED ALWAYS AS IDENTITY,
      hn_id bigint, observed_at timestamptz, score integer);
      INSERT INTO hn_thread_snapshots(hn_id,observed_at,score)
      SELECT 1, CURRENT_TIMESTAMP - n * interval '1 minute', 500 - n FROM generate_series(0,200) n;
      INSERT INTO hn_thread_snapshots(hn_id,observed_at,score) VALUES
      (1,CURRENT_TIMESTAMP - interval '25 hours',0), (1,CURRENT_TIMESTAMP + interval '1 hour',999),
      (2,CURRENT_TIMESTAMP,42);`);
    const {rows} = await db.query(`SELECT t.hn_id, ${activityHistorySQL} AS history FROM (VALUES (1),(2),(3)) t(hn_id) ORDER BY t.hn_id`);
    assert.equal(rows[0].history.length,168);
    assert.equal(rows[0].history[0].score,333);
    assert.equal(rows[0].history.at(-1).score,500);
    assert.ok(rows[0].history.every((p,i,a) => !i || Date.parse(p.observed_at) > Date.parse(a[i-1].observed_at)));
    assert.equal(rows[1].history[0].score,42);
    assert.deepEqual(rows[2].history,[]);
  } finally { await db.close(); }
});


test('headline change follows the measured line direction, not the sign of its latest rate', () => {
  const rates = values => values.map((rate, i) => ({start:i * 3600000, end:(i+1)*3600000, rate}));
  assert.equal(activityChange(rates([127, 40, 4])), -123);
  assert.equal(activityChange(rates([4, 12, 24])), 20);
  assert.equal(activityChange(rates([12, 12])), 0);
  assert.equal(activityChange(rates([32, 0])), -32);
  assert.equal(activityChange(rates([-10, -2])), 8);
  assert.equal(activityChange(rates([12.3])), null);
  assert.equal(activityChange([]), null);
});
