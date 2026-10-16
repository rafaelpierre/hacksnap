import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { seoColumnsSQL } from "../lib/seo-metadata.ts";
import { storyProjection } from "../lib/story-projection.ts";

test("SEO copy is detail-only and tolerates missing columns or partial reader grants", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, url text,
        points int, comment_count int, date_added timestamptz, category text);
      CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, article_summary text,
        article_key_points jsonb, discussion_summary text, discussion_points jsonb, sentiment int,
        overall_takeaway text, generated_at timestamptz, model text, source_coverage jsonb);
      INSERT INTO hacker_news_threads (hn_id,title) VALUES (1,'Visible headline');
      INSERT INTO hacksnap_summaries (story_id,overall_takeaway) VALUES (1,'Takeaway');`);
    assert.equal((await db.query(seoColumnsSQL)).rows[0].available, false);
    const query = (seo) =>
      db.query(`SELECT ${storyProjection("story", false, false, false, false, seo)}
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id=t.hn_id`);
    assert.equal((await query(false)).rows[0].title, "Visible headline");
    await db.exec(`ALTER TABLE hacksnap_summaries ADD COLUMN seo_title text,
      ADD COLUMN seo_description text, ADD COLUMN seo_metadata jsonb;
      UPDATE hacksnap_summaries SET seo_title='Search headline',seo_description='Search description.';
      GRANT SELECT (seo_title) ON hacksnap_summaries TO hacksnap_reader;
      SET ROLE hacksnap_reader;`);
    assert.equal((await db.query(seoColumnsSQL)).rows[0].available, false);
    await db.exec(`RESET ROLE; GRANT SELECT (seo_description) ON hacksnap_summaries TO hacksnap_reader;
      SET ROLE hacksnap_reader;`);
    assert.equal((await db.query(seoColumnsSQL)).rows[0].available, true);
    await assert.rejects(
      db.query("SELECT seo_metadata FROM hacksnap_summaries"),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
    const story = (await query(true)).rows[0];
    assert.equal(story.title, "Visible headline");
    assert.equal(story.summary.seo_title, "Search headline");
    assert.equal(story.summary.seo_description, "Search description.");
    for (const kind of ["feed", "export"])
      assert.doesNotMatch(storyProjection(kind, false, false, false, false, true), /seo_/);
  } finally {
    await db.close();
  }
}, 30000);
