"""Exercise additive headline storage and its reader grant without production access."""

import json
import os
import subprocess

import pytest

from test_story_popularity_migration import render

MIGRATION = "0023_editorial_titles_editorial_titles.py"


def test_editorial_title_migration_is_nullable_and_scoped():
    sql = render("upgrade", MIGRATION)
    assert "ADD COLUMN title TEXT" in sql
    assert "NOT NULL" not in sql
    assert "GRANT SELECT (title)" in sql
    assert "UPDATE hacker_news_threads" not in sql
    assert "DROP COLUMN title" in render("downgrade", MIGRATION)


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_titles_preserve_legacy_rows_and_reader_permissions():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE hacksnap_reader; CREATE ROLE anon;
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, private_field text);
    INSERT INTO hacksnap_summaries VALUES (1, 'private');`);
  await db.exec(input.upgrade);
  assert.equal((await db.query('SELECT title FROM hacksnap_summaries')).rows[0].title, null);
  await db.query('UPDATE hacksnap_summaries SET title=$1 WHERE story_id=1', ['A supported headline']);
  for (const title of ['', '   ', '\t\n', 'x'.repeat(161), 'First\nSecond', 'First\rSecond'])
    await assert.rejects(db.query('UPDATE hacksnap_summaries SET title=$1', [title]), /check constraint/);
  await db.exec('SET ROLE hacksnap_reader');
  assert.deepEqual((await db.query('SELECT title FROM hacksnap_summaries')).rows,
    [{title: 'A supported headline'}]);
  await assert.rejects(db.query('SELECT private_field FROM hacksnap_summaries'), /permission denied/);
  await assert.rejects(db.query("UPDATE hacksnap_summaries SET title='Overwrite'"), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(db.query('SELECT title FROM hacksnap_summaries'), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
  assert.deepEqual((await db.query('SELECT * FROM hacksnap_summaries')).rows,
    [{story_id: 1, private_field: 'private'}]);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True,
        input=json.dumps({"upgrade": render("upgrade", MIGRATION),
                          "downgrade": render("downgrade", MIGRATION)}),
    )
    assert result.returncode == 0, result.stderr
