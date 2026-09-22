import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {archiveMonth, archivePage, archiveURL, monthBounds, archiveQuery, archiveMonthsSQL} from '../lib/archive.ts';

test('archive routes reject ambiguous dates and pagination', () => {
  assert.equal(archiveMonth(['2026', '09']), '2026-09');
  for (const path of [[], ['2026'], ['2026', '13'], ['2026', '9'], ['2026', '09', '01'], ['0000', '01']]) assert.equal(archiveMonth(path), null);
  assert.equal(archivePage(undefined), 1);
  assert.equal(archivePage('2'), 2);
  for (const page of ['0', '-1', '1.5', '01', '10000000', ['1', '2']]) assert.equal(archivePage(page), null);
  assert.equal(archiveURL('2026-09', 2), '/archive/2026/09?page=2');
  assert.equal(archiveURL(null), '/archive');
  assert.deepEqual(monthBounds('2026-12'), ['2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
});

test('archive queries respect UTC boundaries, stable ties, pending summaries and page limits', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY, date_added timestamptz NOT NULL);
      CREATE TABLE hacksnap_summaries(story_id bigint PRIMARY KEY);
      INSERT INTO hacker_news_threads SELECT n, '2026-09-10T12:00:00Z'::timestamptz FROM generate_series(1,65) n;
      INSERT INTO hacker_news_threads VALUES (66,'2026-09-01T00:00:00Z'),(67,'2026-10-01T00:00:00Z'),(68,'2026-08-31T23:59:59Z');
      SET TIME ZONE 'Pacific/Honolulu';`);
    const run = async (month, page) => {
      const query = archiveQuery('t.hn_id, t.date_added', month, page);
      return (await db.query(query.text, query.values)).rows;
    };
    const first = await run('2026-09', 1);
    const second = await run('2026-09', 2);
    const third = await run('2026-09', 3);
    assert.equal(first.length, 31);
    assert.equal(second.length, 31);
    assert.equal(third.length, 6);
    const ids = [...first.slice(0,30), ...second.slice(0,30), ...third].map(r => Number(r.hn_id));
    assert.equal(new Set(ids).size, 66);
    assert.deepEqual(ids.slice(0, 3), [65,64,63]);
    assert.equal(ids.at(-1), 66);
    assert.ok(!ids.includes(67) && !ids.includes(68));
    assert.equal((await run(null, 1))[0].hn_id, 67);
    assert.deepEqual(await run('2026-09', 4), []);
    assert.deepEqual((await db.query(archiveMonthsSQL)).rows, [
      {month:'2026-10',count:1},{month:'2026-09',count:66},{month:'2026-08',count:1},
    ]);
  } finally {await db.close();}
});
