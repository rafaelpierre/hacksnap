import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";

const report = await readFile(new URL("../../../docs/analytics/engagement.sql", import.meta.url), "utf8");

test("return cohort excludes lead-in readers before counting eligible readers", () => {
  // Execute the report's actual firsts/filter predicates. SQLite substitutes MIN(ts)
  // for BigQuery's first-row STRUCT; these normalized UTC fixture timestamps sort
  // identically. This verifies cohort membership, not BigQuery syntax or return rates.
  const firsts = report.match(/WITH firsts AS \(\n([\s\S]*?)\n\), returns AS/)[1];
  const projection = /ARRAY_AGG\(STRUCT\(ts, session_id, device, acquisition_source\) ORDER BY ts LIMIT 1\)\[OFFSET\(0\)\] first/;
  assert.match(firsts, projection);
  const where = report.match(/ WHERE DATE\(f\.first\.ts\)[^\n]+/)[0];
  const sql = `WITH firsts AS (${firsts.replace(projection, "MIN(ts) first_ts")})
    SELECT f.reader FROM firsts f ${where.replaceAll("f.first.ts", "f.first_ts")}
    ORDER BY f.reader`.replaceAll("cohort_start", ":cohort_start").replaceAll("cohort_end", ":cohort_end");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE events (event_name TEXT, reader TEXT, session_id INTEGER, ts TEXT)");
    const add = db.prepare("INSERT INTO events VALUES ('reader_visit', ?, ?, ?)");
    const rows = [
      // Multiple later sessions must not make a lead-in reader newly observed.
      ["lead_in", 1, "2026-09-26T23:59:59Z"],
      ["lead_in", 2, "2026-09-27T10:00:00Z"],
      ["lead_in", 3, "2026-09-28T10:00:00Z"],
      ["at_start", 1, "2026-09-27T00:00:00Z"],
      ["at_start", 2, "2026-09-28T00:00:00Z"],
      ["inside", 1, "2026-10-10T23:59:59Z"],
      ["at_end", 1, "2026-10-11T00:00:00Z"],
      ["follow_up", 1, "2026-10-12T00:00:00Z"],
      ["no_session", null, "2026-09-28T00:00:00Z"],
      [null, 1, "2026-09-28T00:00:00Z"],
    ];
    for (const row of rows) add.run(...row);
    const eligible = db.prepare(sql).all({cohort_start: "2026-09-27", cohort_end: "2026-10-11"});
    assert.deepEqual(eligible.map(row => row.reader), ["at_start", "inside"]);
  } finally { db.close(); }
});
