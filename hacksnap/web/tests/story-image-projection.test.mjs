import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { imageColumnsSQL, imageProjection } from "../lib/story-projection.ts";
import { browseCapabilitiesSQL } from "../lib/browse-capabilities.ts";

test("stored image reads tolerate absent and ungranted columns without exposing source URLs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (
        hn_id bigint PRIMARY KEY, title text, image_source_url text, image_source_type text
      );
      CREATE TABLE hacksnap_summaries (story_id bigint);
      INSERT INTO hacker_news_threads VALUES (123, 'Story', 'https://publisher.example/hero.webp', 'og');
      GRANT SELECT (hn_id, title) ON hacker_news_threads TO hacksnap_reader;
      SET ROLE hacksnap_reader;`);
    for (const phase of ["absent", "ungranted", "source-ungranted", "granted"]) {
      const available = (await db.query(imageColumnsSQL)).rows[0].available;
      assert.equal(available, phase === "granted");
      assert.equal((await db.query(browseCapabilitiesSQL)).rows[0].images_available, available);
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
      if (phase !== "granted")
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
      } else if (phase === "source-ungranted") {
        await db.exec(`RESET ROLE;
          GRANT SELECT (image_source_type) ON hacker_news_threads TO hacksnap_reader;
          SET ROLE hacksnap_reader;`);
      }
    }
    for (const source of ["og", "twitter", "json_ld", "generated", null, "unknown"]) {
      await db.exec("RESET ROLE");
      await db.query("UPDATE hacker_news_threads SET image_source_type = $1", [source]);
      await db.exec("SET ROLE hacksnap_reader");
      const row = (await db.query(`SELECT ${imageProjection(true)} FROM hacker_news_threads t`))
        .rows[0];
      const publisher = ["og", "twitter", "json_ld"].includes(source);
      assert.deepEqual(row, {
        image_url: publisher ? "https://blob.example/hero.webp" : null,
        image_status: publisher ? "ready" : null,
        image_width: publisher ? 1200 : null,
        image_height: publisher ? 630 : null,
        image_mime_type: publisher ? "image/webp" : null,
      });
    }
  } finally {
    await db.close();
  }
}, 30000);
