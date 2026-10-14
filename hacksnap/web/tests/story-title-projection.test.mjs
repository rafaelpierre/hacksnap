import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import {
  storyTitleColumnSQL,
  storyTitleProjection,
  storyIdentityColumnsSQL,
} from "../lib/story-title-projection.ts";
import { storyProjection } from "../lib/story-projection.ts";
import { browseCapabilitiesSQL } from "../lib/browse-capabilities.ts";
import { relatedStoriesQuery } from "../lib/categories.ts";
import { popularStoriesSQL } from "../lib/popular-stories.ts";

test("all headline projections use generated titles and preserve source titles and slugs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, story_slug text,
        url text, points int, comment_count int, date_added timestamptz, category text);
      CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, article_summary text,
        article_key_points jsonb, discussion_summary text, discussion_points jsonb, sentiment int,
        overall_takeaway text, generated_at timestamptz, model text, source_coverage jsonb);
      CREATE TABLE hacksnap_fetch_failures (story_id bigint, article_url text);
      CREATE TABLE hacksnap_story_popularity (story_id bigint, historical_views bigint, story_views bigint);
      CREATE TABLE hacksnap_popularity_events (story_id bigint, kind text, received_at timestamptz);
      INSERT INTO hacker_news_threads (hn_id,title,story_slug,date_added,category)
        VALUES (1,'Original title','original-title-1',now(),'agents_coding'),
        (2,'Legacy title',null,now(),'agents_coding'), (3,'Blank title fallback',null,now(),'agents_coding');
      INSERT INTO hacksnap_summaries (story_id,overall_takeaway) VALUES (1,'Summary'),(2,'Summary'),(3,'Summary');
      INSERT INTO hacksnap_story_popularity VALUES (1,5,1);
      INSERT INTO hacksnap_popularity_events VALUES (1,'view',now());`);
    const query = (fields) =>
      db.query(`SELECT ${fields} FROM hacker_news_threads t
      LEFT JOIN hacksnap_summaries s ON s.story_id=t.hn_id ORDER BY t.hn_id`);
    assert.equal((await db.query(storyTitleColumnSQL)).rows[0].available, false);
    assert.deepEqual((await db.query(storyIdentityColumnsSQL)).rows[0], {
      slug_available: true,
      title_available: false,
    });
    assert.equal(
      (await query(storyProjection("story", false, false))).rows[0].title,
      "Original title",
    );
    await db.exec("ALTER TABLE hacksnap_summaries ADD COLUMN title text;");
    await db.query("UPDATE hacksnap_summaries SET title=$1 WHERE story_id=1", [
      "The generated headline",
    ]);
    await db.query("UPDATE hacksnap_summaries SET title='  ' WHERE story_id=3");
    for (const kind of ["feed", "story", "export"]) {
      const { rows } = await query(storyProjection(kind, false, false, true));
      assert.deepEqual(
        rows.map((row) => row.title),
        ["The generated headline", "Legacy title", "Blank title fallback"],
      );
    }
    const title = storyTitleProjection(true);
    const related = relatedStoriesQuery("agents_coding", "2", "t.story_slug", title);
    assert.equal(
      (await db.query(related.text, related.values)).rows.find((row) => row.hn_id === 1).title,
      "The generated headline",
    );
    for (const period of ["all-time", "last-7-days"])
      assert.equal(
        (await db.query(popularStoriesSQL("t.story_slug", period, title))).rows[0].title,
        "The generated headline",
      );
    assert.deepEqual(
      (await db.query("SELECT title,story_slug FROM hacker_news_threads WHERE hn_id=1")).rows,
      [{ title: "Original title", story_slug: "original-title-1" }],
    );
    await db.exec("SET ROLE hacksnap_reader");
    assert.equal((await db.query(storyTitleColumnSQL)).rows[0].available, false);
    assert.equal((await db.query(browseCapabilitiesSQL)).rows[0].title_available, false);
    await db.exec(
      "RESET ROLE; GRANT SELECT (title) ON hacksnap_summaries TO hacksnap_reader; SET ROLE hacksnap_reader",
    );
    assert.equal((await db.query(storyTitleColumnSQL)).rows[0].available, true);
    assert.equal((await db.query(browseCapabilitiesSQL)).rows[0].title_available, true);
  } finally {
    await db.close();
  }
}, 30000);
