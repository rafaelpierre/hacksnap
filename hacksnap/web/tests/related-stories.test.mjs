import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {relatedStoriesQuery} from '../lib/categories.ts';

test('next reads select the newest available briefs across the whole category', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY, title text, date_added timestamptz, category text);
      CREATE TABLE hacksnap_summaries(story_id bigint PRIMARY KEY, overall_takeaway text);
      INSERT INTO hacker_news_threads VALUES
        (1,'Current',now(),'agents_coding'),
        (2,'Older ready brief',now()-interval '3 days','agents_coding'),
        (3,'Same date, lower ID',now()-interval '2 days','agents_coding'),
        (4,'Same date, higher ID',now()-interval '2 days','agents_coding'),
        (5,'Newest ready brief',now()-interval '1 day','agents_coding'),
        (6,'Different topic',now(),'models_products'),
        (7,'Future story',now()+interval '1 day','agents_coding'),
        (8,'Uncategorized',now(),NULL),
        (0,'Invalid public ID',now(),'agents_coding');
      INSERT INTO hacksnap_summaries SELECT hn_id, 'Takeaway for ' || title FROM hacker_news_threads;
      INSERT INTO hacker_news_threads SELECT n, 'Pending', now(), 'agents_coding' FROM generate_series(10,45) n;
      ALTER TABLE hacker_news_threads ADD COLUMN url text DEFAULT 'https://example.com/article';`);
    const run = async (category, id) => {
      const query = relatedStoriesQuery(category, id);
      return (await db.query(query.text, query.values)).rows;
    };
    const stories = await run('agents_coding', '1');
    assert.deepEqual(stories.map(story => story.hn_id), [5,4,3]);
    assert.equal(stories[0].title, 'Newest ready brief');
    assert.equal(stories[0].takeaway, 'Takeaway for Newest ready brief');
    assert.ok(stories[0].date_added);
    assert.equal(stories[0].url, 'https://example.com/article');
    assert.deepEqual((await run('models_products', '1')).map(story => story.hn_id), [6]);
    assert.deepEqual(await run('models_products', '6'), []);
    assert.deepEqual(await run('safety_privacy', '1'), []);
  } finally {
    await db.close();
  }
});
