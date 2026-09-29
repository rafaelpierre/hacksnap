"""Article image migration shape and web-reader grants, without a live database."""

import json
import os
import subprocess
from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_discussion_migration import load_migration


def render(direction: str) -> str:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    migration = load_migration("0015_article_images.py")
    with Operations.context(context):
        getattr(migration, direction)()
    return output.getvalue()


def test_nullable_canonical_columns_leave_existing_stories_unchanged():
    migration = load_migration("0015_article_images.py")
    assert migration.down_revision == "0014_story_slugs"
    sql = render("upgrade")
    for name in (
        "image_url", "image_source_url", "image_source_type", "image_status",
        "image_width", "image_height", "image_mime_type", "image_attempt_token",
        "image_attempt_count", "image_attempted_at", "image_error",
    ):
        assert f"ADD COLUMN {name}" in sql
    assert "DEFAULT" not in sql and "UPDATE hacker_news_threads" not in sql
    assert "image_url IS NULL" in sql
    assert "hn_image_public_bundle" in sql and "hn_image_lease" in sql
    assert "public[.]blob[.]vercel-storage[.]com/articles/" in sql


def test_reader_receives_only_public_columns_and_downgrade_revokes_first():
    sql = render("upgrade")
    grant = sql[sql.index("GRANT SELECT"):].split(";")[0]
    assert "image_url,image_status,image_width,image_height,image_mime_type" in grant
    for private in (
        "image_source_url", "image_source_type", "image_attempt_token",
        "image_attempt_count", "image_attempted_at", "image_error",
    ):
        assert private not in grant
    assert "CREATE POLICY" not in sql and "DISABLE ROW LEVEL SECURITY" not in sql
    downgrade = render("downgrade")
    assert downgrade.index("REVOKE SELECT") < downgrade.index("DROP COLUMN")
    assert "DROP ROLE" not in downgrade


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"),
                    reason="optional PGlite runtime")
def test_postgres_migration_preserves_old_rows_enforces_bundle_and_private_grants():
    script = r'''
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
await db.exec(`
  CREATE ROLE hacksnap_reader NOLOGIN;
  CREATE TABLE hacker_news_threads (
    hn_id bigint PRIMARY KEY, title text NOT NULL, url text NOT NULL,
    date_added timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO hacker_news_threads(hn_id,title,url) VALUES (1,'old','https://publisher.test');
`);
await db.exec(input.upgrade);
let row = (await db.query(`SELECT image_url,image_status,image_width,image_height,image_mime_type
  FROM hacker_news_threads WHERE hn_id=1`)).rows[0];
assert.deepEqual(row, {image_url:null,image_status:null,image_width:null,
  image_height:null,image_mime_type:null});
await assert.rejects(db.query(`UPDATE hacker_news_threads
  SET image_status='ready',image_url='https://store.public.blob.vercel-storage.com/articles/1.webp'
  WHERE hn_id=1`));
await assert.rejects(db.query(`UPDATE hacker_news_threads
  SET image_status='ready',image_url='https://store.public.blob.vercel-storage.com/articles/1.webp?token=x',
      image_source_type='og',image_width=1200,image_height=630,image_mime_type='image/webp'
  WHERE hn_id=1`));
await db.query(`UPDATE hacker_news_threads
  SET image_status='ready',image_url='https://store.public.blob.vercel-storage.com/articles/1.webp',
      image_source_type='og',image_width=1200,image_height=630,image_mime_type='image/webp'
  WHERE hn_id=1`);
row = (await db.query(`SELECT
  has_column_privilege('hacksnap_reader','hacker_news_threads','image_url','SELECT') AS url,
  has_column_privilege('hacksnap_reader','hacker_news_threads','image_status','SELECT') AS status,
  has_column_privilege('hacksnap_reader','hacker_news_threads','image_width','SELECT') AS width,
  has_column_privilege('hacksnap_reader','hacker_news_threads','image_source_url','SELECT') AS source,
  has_column_privilege('hacksnap_reader','hacker_news_threads','image_attempt_token','SELECT') AS token
`)).rows[0];
assert.deepEqual(row, {url:true,status:true,width:true,source:false,token:false});
await db.exec(input.downgrade);
row = (await db.query(`SELECT count(*)::integer AS count FROM information_schema.columns
  WHERE table_name='hacker_news_threads' AND column_name LIKE 'image_%'`)).rows[0];
assert.equal(row.count, 0);
await db.close();
'''
    subprocess.run(
        ["node", "--input-type=module", "-e", script], check=True,
        capture_output=True, text=True,
        input=json.dumps({"upgrade": render("upgrade"), "downgrade": render("downgrade")}),
    )
