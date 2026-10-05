import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { popularityAvailableSQL, popularStoriesSQL } from "../lib/popular-stories.ts";
import { storySlugProjection } from "../lib/story-slug-projection.ts";
import { recordStoryEventSQL } from "../lib/story-events.ts";

test("the six imported GA baselines rank by views, and a new reader can promote the sixth story", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY,title text,date_added timestamptz);
      CREATE TABLE hacksnap_summaries(story_id bigint PRIMARY KEY,overall_takeaway text);
      CREATE TABLE hacksnap_story_popularity(story_id bigint PRIMARY KEY,historical_views bigint DEFAULT 0,story_views bigint DEFAULT 0,story_clicks bigint DEFAULT 0);
      CREATE TABLE hacksnap_popularity_events(visit_id uuid,story_id bigint,kind text,PRIMARY KEY(visit_id,story_id,kind));
      INSERT INTO hacker_news_threads SELECT n,'Story '||n,now() FROM generate_series(1,6) n;
      INSERT INTO hacksnap_summaries SELECT n,'Ready' FROM generate_series(1,6) n;
      INSERT INTO hacksnap_story_popularity(story_id,historical_views) VALUES (1,322),(2,20),(3,18),(4,12),(5,12),(6,8);`);
    const ranking = async () =>
      (await db.query(popularStoriesSQL(storySlugProjection(false)))).rows;
    assert.deepEqual(
      (await ranking()).map((row) => row.hn_id),
      ["1", "2", "3", "5", "4"],
    );
    const visit = "00000000-0000-4000-8000-000000000001";
    await db.query(recordStoryEventSQL, [visit, "6", "click"]);
    assert.deepEqual(
      (await ranking()).map((row) => row.hn_id),
      ["1", "2", "3", "5", "4"],
    );
    for (let n = 1; n <= 5; n++) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      await db.query(recordStoryEventSQL, [id, "6", "view"]);
      await db.query(recordStoryEventSQL, [id, "6", "view"]);
    }
    const rows = await ranking();
    assert.deepEqual(
      rows.map((row) => row.hn_id),
      ["1", "2", "3", "6", "5"],
    );
    assert.equal(rows[3].views, "13");
  } finally {
    await db.close();
  }
}, 30000);

test("popular ranking includes archived ready stories, excludes invalid/pending/future rows, and never mixes clicks into views", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY,title text,story_slug text,date_added timestamptz);
      CREATE TABLE hacksnap_summaries(story_id bigint PRIMARY KEY,overall_takeaway text);
      CREATE TABLE hacksnap_story_popularity(story_id bigint PRIMARY KEY,historical_views bigint,story_views bigint,story_clicks bigint);
      INSERT INTO hacker_news_threads VALUES
        (1,'Archived',NULL,now()-interval '1 year'),(2,'Tie lower',NULL,now()),(3,'Tie higher','tie-higher-3',now()),
        (4,'Fourth',NULL,now()),(5,'Fifth',NULL,now()),(6,'Sixth',NULL,now()),
        (7,'Pending',NULL,now()),(8,'Future',NULL,now()+interval '1 day'),(9,'Clicks only',NULL,now()),(0,'Invalid',NULL,now());
      INSERT INTO hacksnap_summaries SELECT hn_id,CASE WHEN hn_id=7 THEN ' \n\t ' ELSE 'Ready' END FROM hacker_news_threads;
      INSERT INTO hacksnap_story_popularity VALUES
        (1,9223372036854775807,1,0),(2,20,1,999999),(3,21,0,0),(4,12,0,0),(5,10,0,0),(6,5,0,0),
        (7,500,0,0),(8,500,0,0),(9,0,0,1000000),(0,500,0,0);`);
    const rows = (await db.query(popularStoriesSQL(storySlugProjection(true)))).rows;
    assert.deepEqual(
      rows.map((row) => row.hn_id),
      ["1", "3", "2", "4", "5"],
    );
    assert.equal(rows[0].views, "9223372036854775808");
    assert.equal(rows[1].story_slug, "tie-higher-3");
    assert.equal(rows[0].story_slug, null);
  } finally {
    await db.close();
  }
}, 30000);

test("capability check handles a missing table and partially granted rollout", async () => {
  const db = new PGlite();
  try {
    assert.equal((await db.query(popularityAvailableSQL)).rows[0].available, false);
    await db.exec(`CREATE ROLE hacksnap_reader;
      CREATE TABLE hacksnap_story_popularity(story_id bigint,historical_views bigint,story_views bigint);
      GRANT SELECT(story_id) ON hacksnap_story_popularity TO hacksnap_reader;
      SET ROLE hacksnap_reader;`);
    assert.equal((await db.query(popularityAvailableSQL)).rows[0].available, false);
    await db.exec(
      `RESET ROLE; GRANT SELECT(historical_views,story_views) ON hacksnap_story_popularity TO hacksnap_reader; SET ROLE hacksnap_reader;`,
    );
    assert.equal((await db.query(popularityAvailableSQL)).rows[0].available, true);
  } finally {
    await db.close();
  }
}, 30000);
