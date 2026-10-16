"""Execute the worker's real selection and conditional persistence SQL locally."""
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
    if isinstance(params, dict):
        keys = list(dict.fromkeys(re.findall(r"%\((\w+)\)s", sql)))
        for i, key in enumerate(keys, 1):
            sql = sql.replace(f"%({key})s", f"${i}")
        return {"sql": sql, "params": [params[key] for key in keys]}
    for i in range(1, len(params) + 1):
        sql = sql.replace("%s", f"${i}", 1)
    return {"sql": sql, "params": [json.dumps(p.obj) if hasattr(p, "obj") else p for p in params]}


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_daily_queue_excludes_archive_and_ingestion_age_while_backfill_is_explicit(monkeypatch):
    connection = MagicMock()
    connection.execute.return_value.rowcount = 1
    repository = SeoRepository("postgresql://fixture.invalid/test")
    monkeypatch.setattr(repository, "_connect", lambda: connection)
    execute = connection.__enter__.return_value.execute
    calls = {}
    repository.seo_candidates("v1")
    calls["daily"] = statement(execute.call_args)
    repository.seo_candidates("v2")
    calls["new_prompt"] = statement(execute.call_args)
    repository.seo_candidates("v1", after_id=0)
    calls["backfill"] = statement(execute.call_args)
    repository.seo_candidates("v1", after_id=2, limit=1)
    calls["cursor"] = statement(execute.call_args)
    row = {"story_id": 2, "seo_input_version": 0}
    repository.claim_seo(row)
    calls["claim"] = statement(execute.call_args)
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
  await db.exec(`CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY,title text,url text,date_added timestamptz);
    CREATE TABLE hacksnap_fetch_failures (story_id bigint,article_url text);
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY,title text,article_summary text,
      article_key_points jsonb,overall_takeaway text,discussion_points jsonb,source_coverage jsonb,
      seo_title text,seo_description text,seo_metadata jsonb,seo_input_version bigint DEFAULT 0,
      seo_pending boolean DEFAULT false,seo_attempted_at timestamptz);
    INSERT INTO hacker_news_threads SELECT id,'Title','https://example.com/'||id,'2000-01-01'
      FROM generate_series(1,8) id;
    INSERT INTO hacksnap_summaries (story_id,overall_takeaway,seo_pending,source_coverage)
      SELECT id,'Published',id<>1,'{"article_status":"fetched"}' FROM generate_series(1,8) id;
    UPDATE hacksnap_summaries SET source_coverage='{"article_status":"unavailable"}' WHERE story_id=3;
    UPDATE hacksnap_summaries SET seo_attempted_at=now() WHERE story_id=4;
    INSERT INTO hacksnap_fetch_failures VALUES (5,'https://example.com/5');
    UPDATE hacksnap_summaries SET seo_metadata='{"generation_version":"v1"}' WHERE story_id=6;
    UPDATE hacksnap_summaries SET seo_attempted_at=now()-interval '2 days' WHERE story_id=7;
    UPDATE hacksnap_summaries SET overall_takeaway=' ' WHERE story_id=8;`);
  const ids = async key => (await run(key)).rows.map(r=>r.story_id);
  assert.deepEqual(await ids('daily'),[6,2,7]);
  assert.deepEqual(await ids('new_prompt'),[6,2,7],'prompt updates cannot queue archive');
  assert.deepEqual(await ids('backfill'),[1,2,6,7]);
  assert.deepEqual(await ids('cursor'),[6]);
  assert.equal((await run('claim')).affectedRows,1);
  assert.equal((await run('claim')).affectedRows,0,'concurrent claim must lose');
  await db.exec('UPDATE hacksnap_summaries SET seo_input_version=1 WHERE story_id=2');
  assert.equal((await run('save')).affectedRows,0,'corrected source rejects old result');
  calls.save.params[calls.save.params.length-1]=1;
  assert.equal((await run('save')).affectedRows,1);
  const saved=(await db.query('SELECT * FROM hacksnap_summaries WHERE story_id=2')).rows[0];
  assert.equal(saved.seo_pending,false);
  assert.equal(saved.overall_takeaway,'Published');
  assert.equal(saved.seo_title,'Title');
} finally { await db.close(); }
'''
    result = subprocess.run(["node", "--input-type=module", "-e", script], check=False, text=True,
                            capture_output=True, input=json.dumps(calls))
    assert result.returncode == 0, result.stderr
