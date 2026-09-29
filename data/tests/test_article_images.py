"""Check the additive image migration and its narrow website grants."""

import json
import os
import subprocess
from io import StringIO

import pytest

from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_discussion_migration import load_migration


def render(direction, name="0016_image_queue.py"):
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    migration = load_migration(name)
    migration.op = Operations(context)
    getattr(migration, direction)()
    return output.getvalue()


def test_image_queue_migration_preserves_existing_stories_and_private_worker_fields():
    migration = load_migration("0016_image_queue.py")
    assert migration.down_revision == "0015_article_images"
    sql = render("upgrade")
    assert "ADD COLUMN image_queue_managed BOOLEAN DEFAULT false NOT NULL" in sql
    assert "image_attempts INTEGER DEFAULT '0' NOT NULL" in sql
    assert "GRANT SELECT" not in sql
    assert "image_attempt_token IS NULL" in sql
    assert "NOT image_queue_managed" in sql
    assert "CREATE INDEX hn_image_queue_idx" in sql
    assert "DROP COLUMN image_queue_managed" in render("downgrade")


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_postgres_rejects_partial_ready_rows_and_reader_cannot_write():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, url text,
      date_added timestamptz DEFAULT now());
    INSERT INTO hacker_news_threads(hn_id,title,url) VALUES (42, 'Story', 'https://example.com');
    GRANT SELECT (hn_id) ON hacker_news_threads TO hacksnap_reader;`);
  await db.exec(input.base);
  await db.exec(input.upgrade);
  const row = (await db.query('SELECT image_status,image_url FROM hacker_news_threads WHERE hn_id=42')).rows[0];
  assert.equal(row.image_status, null);
  assert.equal(row.image_url, null);
  const url = 'https://store.public.blob.vercel-storage.com/articles/42/hero-abc.webp';
  const ready = `UPDATE hacker_news_threads SET image_status='ready', image_url=$1,
    image_source_type='generated', image_width=1200, image_height=630,
    image_mime_type='image/webp' WHERE hn_id=42`;
  await assert.rejects(db.query(ready.replace('image_width=1200', 'image_width=NULL'), [url]), /hn_image_public_bundle/);
  await assert.rejects(db.query(ready.replace("image_mime_type='image/webp'", 'image_mime_type=NULL'), [url]), /hn_image_public_bundle/);
  await db.query(ready, [url]);
  await db.exec('SET ROLE hacksnap_reader');
  assert.equal((await db.query('SELECT image_url FROM hacker_news_threads WHERE hn_id=42')).rows[0].image_url, url);
  await assert.rejects(db.query('SELECT image_lease_token FROM hacker_news_threads'), /permission denied/);
  await assert.rejects(db.query('SELECT image_source_url FROM hacker_news_threads'), /permission denied/);
  await assert.rejects(db.query('SELECT image_source_type FROM hacker_news_threads'), /permission denied/);
  await assert.rejects(db.query(`UPDATE hacker_news_threads SET image_status='failed' WHERE hn_id=42`), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True,
        input=json.dumps({"base": render("upgrade", "0015_article_images.py"),
                          "upgrade": render("upgrade"), "downgrade": render("downgrade")}),
        check=False,
    )
    assert result.returncode == 0, result.stderr[-2500:]
