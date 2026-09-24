import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {CATEGORIES, categoryBySlug, categoryById, categoryURL, categoryQuery, categoryCountsSQL} from '../lib/categories.ts';

test('category routes use a fixed taxonomy and canonical pagination', () => {
  assert.equal(CATEGORIES.length, 6);
  for (const category of CATEGORIES) {
    assert.equal(categoryById(category.id), categoryBySlug(category.slug));
    assert.equal(categoryURL(category, 2), `/category/${category.slug}?page=2`);
  }
  for (const slug of ['other', '__proto__', 'agents_coding', 'AGENTS-CODING']) assert.equal(categoryBySlug(slug), undefined);
  assert.equal(categoryById(null), undefined);
});

test('category pages include the archive, exclude other topics and paginate stably', async () => {
  const db = new PGlite();
  await db.waitReady;
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY, date_added timestamptz, category text);
      CREATE TABLE hacksnap_summaries(story_id bigint PRIMARY KEY);
      INSERT INTO hacker_news_threads SELECT n, now() - interval '90 days', 'agents_coding' FROM generate_series(1,65) n;
      INSERT INTO hacker_news_threads VALUES (66,now(),'models_products'), (67,now(),NULL), (68,now()+interval '1 day','agents_coding');`);
    const run = async page => {const query = categoryQuery('t.hn_id', 'agents_coding', page); return (await db.query(query.text, query.values)).rows;};
    const first = await run(1), second = await run(2), third = await run(3);
    assert.deepEqual([first.length, second.length, third.length], [31,31,5]);
    const ids = [...first.slice(0,30),...second.slice(0,30),...third].map(row => row.hn_id);
    assert.equal(new Set(ids).size, 65);
    assert.deepEqual(ids.slice(0,3), [65,64,63]);
    assert.deepEqual(await run(4), []);
    const counts = (await db.query(categoryCountsSQL)).rows;
    assert.equal(counts.find(row => row.category === 'agents_coding').count, 65);
    assert.equal(counts.find(row => row.category === 'models_products').count, 1);
    assert.equal(counts.length, 2);
  } finally {await db.close();}
});
