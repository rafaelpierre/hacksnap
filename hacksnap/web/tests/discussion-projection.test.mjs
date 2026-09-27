import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { feedFields, storyFields } from "../lib/story-projection.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url)),
);
const metadata = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/metadata.json", import.meta.url)),
);
const migration = readFileSync(
  new URL("../../../data/migrations/versions/0012_discussion_analysis.py", import.meta.url),
  "utf8",
);

function fixtureMetadata(fixture) {
  if (!fixture.expected) return null;
  const included = fixture.inputs.comments.length;
  return {
    ...metadata,
    coverage: {
      ...metadata.coverage,
      stored_comments: included,
      included_comments: included,
      comments_truncated: false,
    },
  };
}

test("reader projections preserve shared fixtures and legacy rows while excluding private data", async () => {
  const db = new PGlite();
  try {
    // A minimal additive-schema fixture uses the migration's actual reader grant.
    // Keep private columns present so accidental broad reads fail as the reader.
    await db.exec(`
      CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads (
        hn_id bigint PRIMARY KEY, title text, url text, points int,
        comment_count int, date_added timestamptz, category text, raw_comments jsonb
      );
      CREATE TABLE hacksnap_summaries (
        story_id bigint PRIMARY KEY, article_summary text, article_key_points jsonb,
        discussion_summary text, discussion_points jsonb, sentiment int,
        overall_takeaway text, generated_at timestamptz, model text, source_coverage jsonb,
        source_fingerprint text, discussion_analysis jsonb,
        discussion_analysis_metadata jsonb, discussion_analyzed_at timestamptz,
        discussion_analysis_coverage jsonb GENERATED ALWAYS AS
          (discussion_analysis_metadata -> 'coverage') STORED
      );
      GRANT SELECT (hn_id,title,url,points,comment_count,date_added,category)
        ON hacker_news_threads TO hacksnap_reader;
      GRANT SELECT (story_id,article_summary,article_key_points,discussion_summary,
        discussion_points,sentiment,overall_takeaway,generated_at,model,source_coverage)
        ON hacksnap_summaries TO hacksnap_reader;
      ${migration.match(/GRANT SELECT \(discussion_analysis,[\s\S]*?TO hacksnap_reader/)[0]};
    `);
    const cases = [
      ...fixtures,
      { id: "legacy", expected: null },
      { id: "pending", expected: null },
    ];
    for (const [index, fixture] of cases.entries()) {
      await db.query("INSERT INTO hacker_news_threads (hn_id,title) VALUES ($1,$2)", [
        index + 1,
        fixture.id,
      ]);
      if (fixture.id === "pending") continue;
      await db.query(
        `INSERT INTO hacksnap_summaries (story_id, discussion_summary,
        discussion_analysis, discussion_analysis_metadata, discussion_analyzed_at)
        VALUES ($1, 'Legacy discussion still works', $2, $3, $4)`,
        [
          index + 1,
          fixture.expected,
          fixtureMetadata(fixture),
          fixture.expected ? metadata.analyzed_at : null,
        ],
      );
    }
    await db.exec("SET ROLE hacksnap_reader");
    for (const fields of [storyFields, feedFields]) {
      const { rows } = await db.query(`SELECT ${fields} FROM hacker_news_threads t
        LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id ORDER BY t.hn_id`);
      for (const [index, fixture] of cases.entries()) {
        const summary = rows[index].summary;
        if (fixture.id === "pending") {
          assert.equal(summary, null);
          continue;
        }
        assert.equal(summary.discussion_summary, "Legacy discussion still works");
        assert.equal(summary.discussion_analysis_coverage === null, fixture.expected === null);
        if (fixture.expected) {
          assert.deepEqual(summary.discussion_analysis_coverage, fixtureMetadata(fixture).coverage);
          assert.equal(
            new Date(summary.discussion_analyzed_at).toISOString(),
            new Date(metadata.analyzed_at).toISOString(),
          );
        } else {
          assert.equal(summary.discussion_analyzed_at, null);
        }
        if (fields === storyFields) {
          assert.deepEqual(summary.discussion_analysis, fixture.expected);
          assert.equal(summary.discussion_analysis_preview, undefined);
        } else {
          assert.equal(summary.discussion_analysis, undefined);
          assert.deepEqual(
            summary.discussion_analysis_preview,
            fixture.expected
              ? {
                  status: fixture.expected.status,
                  topics: fixture.expected.topics.map(({ key, title, summary }) => ({
                    key,
                    title,
                    summary,
                  })),
                  selected_evidence: {
                    critical: fixture.expected.critical_comments.length,
                    supportive: fixture.expected.supportive_comments.length,
                  },
                }
              : null,
          );
          assert.doesNotMatch(
            JSON.stringify(summary),
            /paraphrase|explanation|claim_id|comment_ids|reference_claims/,
          );
        }
        assert.doesNotMatch(
          JSON.stringify(summary),
          /input_fingerprint|source_version|prompt_version|schema_version|raw_comments|discussion_analysis_metadata/,
        );
      }
    }
    await assert.rejects(
      db.query("SELECT discussion_analysis_metadata FROM hacksnap_summaries"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("SELECT raw_comments FROM hacker_news_threads"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
}, 30000);
