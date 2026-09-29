import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { storySlugColumnSQL, storySlugProjection } from "../lib/story-slug-projection.ts";
import { storyPath } from "../lib/story-url.ts";

test("slug reads tolerate staged schema rollout and work through ranked views", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, private_data text);
      INSERT INTO hacker_news_threads VALUES (123,'Old story','private'),(124,'New story','private');
      CREATE VIEW hacksnap_ranked_stories WITH (security_invoker=true) AS SELECT hn_id,title FROM hacker_news_threads;
      GRANT SELECT (hn_id,title) ON hacker_news_threads TO hacksnap_reader;
      GRANT SELECT ON hacksnap_ranked_stories TO hacksnap_reader;
      SET ROLE hacksnap_reader;`);
    for (const phase of ["absent", "ungranted", "granted"]) {
      const available = (await db.query(storySlugColumnSQL)).rows[0].available;
      assert.equal(available, phase === "granted");
      for (const table of ["hacker_news_threads", "hacksnap_ranked_stories"]) {
        const rows = (
          await db.query(
            `SELECT t.hn_id, ${storySlugProjection(available)} FROM ${table} t ORDER BY t.hn_id`,
          )
        ).rows;
        assert.equal(storyPath(String(rows[0].hn_id), rows[0].story_slug), "/story/123");
        assert.equal(
          storyPath(String(rows[1].hn_id), rows[1].story_slug),
          phase === "granted" ? "/story/new-story-124" : "/story/124",
        );
      }
      await assert.rejects(
        db.query("SELECT private_data FROM hacker_news_threads"),
        /permission denied/,
      );
      if (phase === "absent")
        await db.exec(`RESET ROLE;
        ALTER TABLE hacker_news_threads ADD COLUMN story_slug text;
        UPDATE hacker_news_threads SET story_slug='new-story-124' WHERE hn_id=124;
        SET ROLE hacksnap_reader;`);
      else if (phase === "ungranted")
        await db.exec(`RESET ROLE;
        GRANT SELECT (story_slug) ON hacker_news_threads TO hacksnap_reader;
        SET ROLE hacksnap_reader;`);
    }
  } finally {
    await db.close();
  }
}, 30000);
