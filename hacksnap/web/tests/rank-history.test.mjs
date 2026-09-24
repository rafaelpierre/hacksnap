import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { rankHistorySQL, rankSamples, rankChange, rankChart, formatRankDuration, formatRankChange } from '../lib/rank-history.ts';
const asOf = '2026-09-20T12:00:00Z';
const sample = (hour, rank) => ({observed_at: `2026-09-20T${String(hour).padStart(2, '0')}:00:00Z`, rank});

test('climbing ranks rise, falling ranks drop, and unchanged ranks remain flat', () => {
  for (const [ranks, change] of [[[8, 5, 2], 6], [[2, 5, 8], -6], [[3, 3, 3], 0], [[12, 4, 7], 5]]) {
    const samples = rankSamples(ranks.map((rank, i) => sample(i + 1, rank)), asOf);
    assert.equal(rankChange(samples), change);
    const chart = rankChart(samples);
    assert.equal(Math.sign(chart.points[0].y - chart.points.at(-1).y), Math.sign(change));
    assert.ok(chart.max >= Math.max(...ranks));
  }
  assert.equal(formatRankChange(6), '+6');
  assert.equal(formatRankChange(-6), '−6');
  assert.equal(formatRankChange(0), '0');
});

test('current displayed rank is the endpoint, including movement since the last refresh', () => {
  const samples = rankSamples([sample(8, 12), sample(10, 7)], asOf, '3');
  assert.deepEqual(samples.at(-1), {at: Date.parse(asOf), rank: 3});
  assert.equal(rankChange(samples), 9);
  assert.equal(rankChart(samples).points.at(-1).x, 154);
  assert.equal(rankSamples([sample(12, 5)], asOf, '3').length, 1);
});

test('invalid, future, duplicate and expired positions are excluded', () => {
  const samples = rankSamples([sample(3, 4), sample(1, 8), sample(1, 8), sample(13, 2),
    {observed_at:'2026-09-18T00:00:00Z',rank:1}, {observed_at:'invalid',rank:3},
    sample(2, NaN), sample(4, 0), sample(5, -1), sample(6, 1.5)], asOf);
  assert.deepEqual(samples.map(p => p.rank), [8, 4]);
  assert.equal(rankSamples([], asOf, 'invalid').length, 0);
});

test('sparse history never invents a trend or a flat lead-in', () => {
  assert.equal(rankChange([]), null);
  const samples = rankSamples([sample(10, 3)], asOf);
  assert.equal(rankChange(samples), null);
  const chart = rankChart(samples);
  assert.ok(chart.points[0].x > 6);
  assert.equal(chart.path, `M${chart.points[0].x},${chart.points[0].y}`);
  assert.equal(rankChart([]).path, '');
});

test('recorded-history mode retains archived ranks without changing the homepage window', () => {
  const history = [{observed_at: '2020-01-01T00:00:00Z', rank: 8},
    {observed_at: '2020-01-03T00:00:00Z', rank: 2}, sample(13, 1)];
  assert.deepEqual(rankSamples(history, asOf), []);
  const recorded = rankSamples(history, asOf, undefined, Infinity);
  assert.deepEqual(recorded.map(point => point.rank), [8, 2]);
  assert.equal(rankChange(recorded), 6);
  assert.ok(rankChart(recorded).path.includes('C'));
});

test('rank query isolates stories, filters the 24h window, caps payload and returns chronological positions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacksnap_rank_history(hn_id bigint, observed_at timestamptz, rank bigint,
      PRIMARY KEY (hn_id, observed_at));
      INSERT INTO hacksnap_rank_history(hn_id,observed_at,rank)
      SELECT 1, CURRENT_TIMESTAMP - n * interval '1 minute', n + 1 FROM generate_series(0,200) n;
      INSERT INTO hacksnap_rank_history(hn_id,observed_at,rank) VALUES
      (1,CURRENT_TIMESTAMP - interval '25 hours',250), (1,CURRENT_TIMESTAMP + interval '1 hour',2),
      (2,CURRENT_TIMESTAMP,42);`);
    const {rows} = await db.query(`SELECT t.hn_id, ${rankHistorySQL} AS history FROM (VALUES (1),(2),(3)) t(hn_id) ORDER BY t.hn_id`);
    assert.equal(rows[0].history.length,168);
    assert.equal(rows[0].history[0].rank,168);
    assert.equal(rows[0].history.at(-1).rank,1);
    assert.ok(rows[0].history.every((p,i,a) => !i || Date.parse(p.observed_at) > Date.parse(a[i-1].observed_at)));
    assert.equal(rows[1].history[0].rank,42);
    assert.deepEqual(rows[2].history,[]);
  } finally { await db.close(); }
});


test('available history fills the width while preserving elapsed-time spacing', () => {
  const chart = rankChart(rankSamples([sample(8, 8), sample(9, 5), sample(12, 2)], asOf));
  assert.deepEqual(chart.points.map(p => p.x), [6, 43, 154]);
  assert.equal(chart.duration, 4 * 3600000);
  assert.equal(formatRankDuration(chart.duration), '4h');
  assert.equal(formatRankDuration(0), 'Now');
  assert.equal(formatRankDuration(30000), '<1m');
  assert.equal(formatRankDuration(15 * 60000), '15m');
});

test('curves pass through observations and cannot overshoot peaks or flat intervals', () => {
  const chart = rankChart(rankSamples([sample(1, 8), sample(2, 2), sample(3, 2), sample(4, 9)], asOf));
  const segments = chart.path.split(' C').slice(1);
  assert.equal(segments.length, 3);
  segments.forEach((segment, i) => {
    const [x1, y1, x2, y2, x3, y3] = segment.split(/[ ,]/).map(Number);
    const a = chart.points[i], b = chart.points[i + 1];
    assert.ok(x1 > a.x && x2 > x1 && x3 > x2);
    assert.equal(y1, a.y);
    assert.equal(y2, b.y);
    assert.equal(y3, b.y);
    assert.equal(x3, b.x);
    for (let t = 0; t <= 1; t += 0.05) {
      const y = (1-t)**3*a.y + 3*(1-t)**2*t*y1 + 3*(1-t)*t*t*y2 + t**3*y3;
      assert.ok(y >= Math.min(a.y,b.y)-1e-9 && y <= Math.max(a.y,b.y)+1e-9);
    }
  });
});
