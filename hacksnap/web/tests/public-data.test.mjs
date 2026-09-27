import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";
import { discussionColumnsSQL } from "../lib/story-projection.ts";
import { publicStorySQL } from "../lib/public-story.ts";

let reads = 0;
let schemaChecks = 0;
let discussionAvailable = true;
const statements = [];
let fail = false;
let hold;
const analysis = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url)),
)[0].expected;
const row = { hn_id: "123", title: "Example", date_added: new Date(), summary: null };
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/cache", () => ({
  unstable_cache: (fn) => fn,
  unstable_noStore: () => {},
}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    on() {}
    async connect() {
      return {
        async query(sql, values) {
          if (sql === discussionColumnsSQL) {
            schemaChecks++;
            return { rows: [{ available: discussionAvailable }] };
          }
          if (!sql.startsWith("SELECT")) return { rows: [] };
          reads++;
          statements.push(sql);
          if (fail) throw new Error("private connection failure");
          if (hold) await hold;
          if (sql === publicStorySQL(discussionAvailable)) {
            assert.ok(values && values.length === 1);
            return {
              rows:
                values[0] === "999"
                  ? []
                  : [
                      values[0] === "777" || values[0] === "778"
                        ? {
                            ...row,
                            summary: {
                              article_summary: "Article",
                              discussion_summary: "Discussion",
                              overall_takeaway: "Takeaway",
                              discussion_analysis: discussionAvailable ? analysis : null,
                              discussion_analyzed_at: discussionAvailable
                                ? "2026-09-27T12:00:00Z"
                                : null,
                              discussion_analysis_coverage: null,
                            },
                          }
                        : row,
                    ],
            };
          }
          return { rows: [row] };
        },
        release() {},
      };
    }
  },
}));
const data = await import("../lib/data.ts");
const { GET } = await import("../app/api/stories/[id]/route.ts");

test("detail handler with a mocked database uses one minimal read for repeated requests, including misses", async () => {
  const previous = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const detail = (id) =>
    GET(new Request(`http://localhost/api/stories/${id}`), { params: Promise.resolve({ id }) });
  try {
    for (const id of ["0", "01", "1 OR 1=1", "1000000000000000"]) {
      assert.equal((await detail(id)).status, 400);
      assert.equal(await data.getPublicStory(id), null);
    }
    assert.equal(reads, 0);
    const responses = await Promise.all([detail("123"), detail("123"), detail("123")]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).date_added, row.date_added.toISOString());
    }
    assert.equal(reads, 1);
    assert.equal(schemaChecks, 1, "same-ID calls share the schema check as well");
    assert.deepEqual(
      statements,
      [publicStorySQL()],
      "API never loads ranking or history projections",
    );
    for (let i = 0; i < 3; i++) assert.equal((await detail("999")).status, 404);
    assert.equal(reads, 2);
    fail = true;
    for (let i = 0; i < 2; i++) {
      const response = await detail("456");
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(reads, 4);
    fail = false;
    for (let i = 0; i < 3; i++) await data.getStory("123");
    assert.equal(reads, 5, "expensive rendering reads are cached separately");
    for (let i = 0; i < 3; i++) await data.getFeedStories();
    assert.equal(reads, 6, "RSS data is cached behind the handler");
  } finally {
    if (previous === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previous;
    delete globalThis.hacksnapPool;
  }
});

test("excess distinct renderer loads preserve the recoverable outage contract", async () => {
  const { DataUnavailableError } = await import("../lib/data-availability.ts");
  const previous = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  const pending = ["2001", "2002", "2003", "2004"].map((id) => data.getStory(id));
  try {
    await assert.rejects(data.getStory("2005"), DataUnavailableError);
  } finally {
    release();
    await Promise.all(pending);
    hold = undefined;
    if (previous === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previous;
    delete globalThis.hacksnapPool;
  }
});

test("minimal detail preserves discussion exports and the missing-schema fallback", async () => {
  const previous = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const [id, available] of [
      ["777", true],
      ["778", false],
    ]) {
      discussionAvailable = available;
      const response = await GET(new Request(`http://localhost/api/stories/${id}`), {
        params: Promise.resolve({ id }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      expect(body.summary.discussion_analysis).toEqual(
        available
          ? {
              ...analysis,
              analyzed_at: "2026-09-27T12:00:00Z",
              coverage: null,
            }
          : null,
      );
      const sql = statements.at(-1);
      assert.equal(sql, publicStorySQL(available));
      assert.doesNotMatch(
        sql,
        /hacksnap_ranked_stories|hacksnap_rank_history|article_key_points|source_coverage|s\.model/,
      );
      if (!available) assert.doesNotMatch(sql, /s\.discussion_analysis|s\.discussion_analyzed_at/);
    }
  } finally {
    discussionAvailable = true;
    warning.mockRestore();
    if (previous === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previous;
    delete globalThis.hacksnapPool;
  }
});
