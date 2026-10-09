"""The image source grant must preserve private diagnostics and read-only access."""

import json
import os
import subprocess

import pytest

from test_discussion_migration import load_migration
from test_story_popularity_migration import render


def test_image_source_migration_only_changes_one_reader_grant():
    migration = load_migration("0022_image_source_reader.py")
    assert migration.down_revision == "0021_weekly_story_popularity"
    assert render("upgrade", "0022_image_source_reader.py").strip() == (
        "GRANT SELECT (image_source_type) ON public.hacker_news_threads TO hacksnap_reader;"
    )
    assert render("downgrade", "0022_image_source_reader.py").strip() == (
        "REVOKE SELECT (image_source_type) ON public.hacker_news_threads FROM hacksnap_reader;"
    )


@pytest.mark.skipif(
    not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime"
)
def test_reader_can_read_source_type_but_not_private_fields_or_write():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads (
      image_source_type text, image_source_url text, image_error text
    );
    INSERT INTO hacker_news_threads VALUES ('generated', 'https://private.example', 'diagnostic');`);
  await db.exec(input.upgrade);
  await db.exec('SET ROLE hacksnap_reader');
  assert.deepEqual((await db.query('SELECT image_source_type FROM hacker_news_threads')).rows,
    [{image_source_type: 'generated'}]);
  for (const column of ['image_source_url', 'image_error'])
    await assert.rejects(db.query('SELECT '+column+' FROM hacker_news_threads'), /permission denied/);
  await assert.rejects(db.query("UPDATE hacker_news_threads SET image_source_type='og'"), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
  await db.exec('SET ROLE hacksnap_reader');
  await assert.rejects(db.query('SELECT image_source_type FROM hacker_news_threads'), /permission denied/);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True,
        input=json.dumps({
            "upgrade": render("upgrade", "0022_image_source_reader.py"),
            "downgrade": render("downgrade", "0022_image_source_reader.py"),
        }),
    )
    assert result.returncode == 0, result.stderr
