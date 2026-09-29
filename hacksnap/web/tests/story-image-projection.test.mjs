import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { imageColumnsSQL, imageProjection } from "../lib/story-projection.ts";

test("stored image reads tolerate absent and ungranted columns without exposing source URLs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (
        hn_id bigint PRIMARY KEY, title text, image_source_url text, image_source_type text
      );
      INSERT INTO hacker_news_threads VALUES (123, 'Story', 'https://publisher.example/hero.webp');
      GRANT SELECT (hn_id, title) ON hacker_news_threads TO hacksnap_reader;
      SET ROLE hacksnap_reader;`);
    for (const phase of ["absent", "ungranted", "granted"]) {
      const available = (await db.query(imageColumnsSQL)).rows[0].available;
      assert.equal(available, phase === "granted");
      const rows = (
        await db.query(`SELECT t.hn_id, ${imageProjection(available)}
        FROM hacker_news_threads t`)
      ).rows;
      assert.equal(
        rows[0].image_url,
        phase === "granted" ? "https://blob.example/hero.webp" : null,
      );
      assert.equal("image_source_type" in rows[0], false);
      assert.equal("image_source_url" in rows[0], false);
      await assert.rejects(
        db.query("SELECT image_source_url FROM hacker_news_threads"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("SELECT image_source_type FROM hacker_news_threads"),
        /permission denied/,
      );
      if (phase === "absent") {
        await db.exec(`RESET ROLE;
          ALTER TABLE hacker_news_threads ADD COLUMN image_url text, ADD COLUMN image_status text,
            ADD COLUMN image_width integer, ADD COLUMN image_height integer, ADD COLUMN image_mime_type text;
          UPDATE hacker_news_threads SET image_url='https://blob.example/hero.webp',
            image_status='ready', image_width=1200, image_height=630, image_mime_type='image/webp';
          SET ROLE hacksnap_reader;`);
      } else if (phase === "ungranted") {
        await db.exec(`RESET ROLE;
          GRANT SELECT (image_url, image_status, image_width, image_height, image_mime_type)
            ON hacker_news_threads TO hacksnap_reader;
          SET ROLE hacksnap_reader;`);
      }
    }
  } finally {
    await db.close();
  }
}, 30000);
