"""Exercise direct selection and source comparisons in PostgreSQL without queues."""
import json
import os
import re
import subprocess
from unittest.mock import MagicMock

import pytest

from pipeline.seo import SearchMetadata
from pipeline.seo_repository import SeoRepository


def statement(call):
    sql, params = call.args
    keys = list(dict.fromkeys(re.findall(r"%\((\w+)\)s", sql)))
    for i, key in enumerate(keys, 1):
        sql = sql.replace(f"%({key})s", f"${i}")
    return {"sql": sql, "params": [json.dumps(params[k].obj) if hasattr(params[k], "obj")
                                   else params[k] for k in keys]}


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_recent_selection_manual_cursor_and_source_guard_without_triggers(monkeypatch):
    connection = MagicMock()
    repository = SeoRepository("postgresql://fixture.invalid/test")
    monkeypatch.setattr(repository, "_connect", lambda: connection)
    execute = connection.__enter__.return_value.execute
    calls = {}
    for name, options in (("daily", {"limit": 2}), ("backfill", {"after_id": 0}),
                          ("cursor", {"after_id": 2, "limit": 1})):
        repository.seo_candidates(**options)
        calls[name] = statement(execute.call_args)
    row = {"story_id": 2, "original_title": "Title", "overall_takeaway": "Published",
           "source_coverage": {"article_status": "fetched"}}
    repository.save_seo(row, SearchMetadata(seo_title="Title", seo_description="Description."),
                        {"generation_version": "v1"})
    calls["save"] = statement(execute.call_args)
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const calls = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
const run = key => db.query(calls[key].sql,calls[key].params);
try {
  await db.exec(`CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY,title text,url text);
    CREATE TABLE hacksnap_fetch_failures (story_id bigint,article_url text);
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY,title text,article_summary text,
      article_key_points jsonb,overall_takeaway text,discussion_points jsonb,source_coverage jsonb,
      seo_title text,seo_description text,seo_metadata jsonb,generated_at timestamptz);
    INSERT INTO hacker_news_threads SELECT id,'Title','https://example.com/'||id FROM generate_series(1,6) id;
    INSERT INTO hacksnap_summaries (story_id,overall_takeaway,source_coverage,generated_at)
      SELECT id,'Published','{"article_status":"fetched"}',now()-id*interval '1 day' FROM generate_series(1,6) id;
    UPDATE hacksnap_summaries SET source_coverage='{"article_status":"unavailable"}' WHERE story_id=3;
    INSERT INTO hacksnap_fetch_failures VALUES (5,'https://example.com/5');
    UPDATE hacksnap_summaries SET overall_takeaway=' ' WHERE story_id=6;`);
  const ids = async key => (await run(key)).rows.map(r=>r.story_id);
  assert.deepEqual(await ids('daily'),[1,2], 'most recent summaries, not highest HN IDs');
  assert.deepEqual(await ids('backfill'),[1,2,4]);
  assert.deepEqual(await ids('cursor'),[4]);
  for (const [table, key, field, value, original] of [
    ['hacker_news_threads','hn_id','title',"'Corrected'","'Title'"],
    ['hacksnap_summaries','story_id','article_summary',"'Corrected'",'NULL'],
    ['hacksnap_summaries','story_id','article_key_points',"'[\"Changed\"]'",'NULL'],
    ['hacksnap_summaries','story_id','source_coverage',"'{\"article_status\":\"unavailable\"}'","'{\"article_status\":\"fetched\"}'"],
  ]) {
    await db.exec(`UPDATE ${table} SET ${field}=${value} WHERE ${key}=2`);
    assert.equal((await run('save')).affectedRows,0,'changed source must reject stale output');
    await db.exec(`UPDATE ${table} SET ${field}=${original} WHERE ${key}=2`);
  }
  await db.exec("INSERT INTO hacksnap_fetch_failures VALUES(2,'https://example.com/2')");
  assert.equal((await run('save')).affectedRows,0);
  await db.exec('DELETE FROM hacksnap_fetch_failures WHERE story_id=2');
  assert.equal((await run('save')).affectedRows,1);
  assert.equal((await run('save')).affectedRows,0,'concurrent save must not overwrite newer metadata');
  assert.equal((await db.query('SELECT seo_title FROM hacksnap_summaries WHERE story_id=2')).rows[0].seo_title,'Title');
} finally { await db.close(); }
'''
    result = subprocess.run(["node", "--input-type=module", "-e", script], check=False, text=True,
                            capture_output=True, input=json.dumps(calls))
    assert result.returncode == 0, result.stderr
