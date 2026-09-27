import assert from "node:assert/strict";
import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { storiesHandlers } from "../lib/stories-api.ts";
import { GET, HEAD } from "../app/.well-known/api-catalog/route.ts";

test("catalog advertises the actual API, spec and documentation; HEAD supports discovery", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/linkset\+json/);
  const { linkset } = await response.json();
  const api = linkset.find((entry) => entry["service-desc"]);
  assert.equal(linkset[0].item[0].href, api.anchor);
  assert.equal(api["service-desc"][0].href, "https://hacksnap.live/openapi.json");
  assert.equal(api["service-doc"][0].href, "https://hacksnap.live/docs/api");
  const head = HEAD();
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("link"), /rel="api-catalog"/);
  assert.equal(head.headers.get("content-type"), response.headers.get("content-type"));
  const spec = JSON.parse(readFileSync(new URL("../app/openapi.json/spec.json", import.meta.url)));
  assert.ok(spec.paths[new URL(api.anchor).pathname].get);
  assert.ok(spec.paths["/api/stories/{id}"].get);
});

const story = {
  hn_id: "123",
  title: "Example",
  url: "https://example.com",
  points: 2,
  category: "agents_coding",
  category_model: "private-classifier",
  comment_count: 1,
  date_added: new Date("2026-09-19T12:00:00Z"),
  summary: {
    article_summary: null,
    discussion_summary: "Discussion",
    overall_takeaway: "Takeaway",
    model: "private-extra",
  },
  internal_diagnostics: "must never be exposed",
};

test("list and detail expose only documented fields and preserve pending summaries", async () => {
  const api = storiesHandlers({
    getLeaderboard: async () => ({
      stories: [story, { ...story, hn_id: "124", summary: null }],
      ingestion: null,
    }),
    getStory: async () => story,
  });
  const list = await (await api.list()).json();
  assert.equal(list.ingestion, null);
  assert.equal(list.stories[1].summary, null);
  assert.equal(list.stories[0].date_added, "2026-09-19T12:00:00.000Z");
  assert.equal(list.stories[0].internal_diagnostics, undefined);
  assert.equal(list.stories[0].category, "agents_coding");
  assert.equal(list.stories[0].category_model, undefined);
  assert.equal(list.stories[0].summary.model, undefined);
  const detail = await (await api.detail("123")).json();
  assert.equal(detail.summary.discussion_analysis, null);
  delete detail.summary.discussion_analysis;
  expect(detail).toEqual(list.stories[0]);
});

test("invalid IDs do not reach data access; missing stories return 404", async () => {
  let reads = 0;
  const api = storiesHandlers({
    getStory: async () => {
      reads++;
      return null;
    },
  });
  for (const id of ["0", "01", "-1", "1.5", "abc", "1 OR 1=1", "1000000000000000"]) {
    assert.equal((await api.detail(id)).status, 400);
  }
  assert.equal(reads, 0);
  assert.equal((await api.detail("999999999999999")).status, 404);
  assert.equal(reads, 1);
});

test("empty lists succeed and database failures return sanitized, uncacheable 503s", async () => {
  const empty = storiesHandlers({ getLeaderboard: async () => ({ stories: [], ingestion: null }) });
  expect(await (await empty.list()).json()).toEqual({ stories: [], ingestion: null });
  const fail = async () => {
    throw new Error("postgres://secret-credentials");
  };
  const api = storiesHandlers({ getLeaderboard: fail, getStory: fail });
  for (const response of [await api.list(), await api.detail("123")]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    expect(await response.json()).toEqual({ error: "Stories are temporarily unavailable" });
  }
});

const analysisFixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url)),
);
const spec = JSON.parse(readFileSync(new URL("../app/openapi.json/spec.json", import.meta.url)));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateStory = ajv.compile({
  ...spec.components.schemas.Story,
  components: spec.components,
});
const coverage = {
  stored_comments: 12,
  included_comments: 3,
  comments_truncated: true,
  selection_method: "active_branches_with_ancestors_v1",
};

test.each(analysisFixtures)(
  "detail conforms to OpenAPI and preserves evidence: $id",
  async ({ expected }) => {
    const api = storiesHandlers({
      getStory: async () => ({
        ...story,
        summary: {
          ...story.summary,
          discussion_analysis: expected,
          discussion_analyzed_at: "2026-09-27T09:00:00Z",
          discussion_analysis_coverage: coverage,
        },
      }),
    });
    const response = await (await api.detail("123")).json();
    assert.ok(validateStory(response), JSON.stringify(validateStory.errors));
    expect(response.summary.discussion_analysis).toEqual({
      ...expected,
      analyzed_at: "2026-09-27T09:00:00Z",
      coverage,
    });
    assert.equal(response.summary.discussion_summary, story.summary.discussion_summary);
    for (const highlight of [...expected.critical_comments, ...expected.supportive_comments]) {
      assert.ok(
        response.summary.discussion_analysis.reference_claims.some(
          (claim) => claim.id === highlight.claim_id,
        ),
      );
    }
  },
);

test("null, absent, pending and compact list responses conform to OpenAPI", async () => {
  const rows = [
    story,
    { ...story, summary: null },
    { ...story, summary: { ...story.summary, discussion_analysis: null } },
  ];
  for (const row of rows) {
    const api = storiesHandlers({
      getStory: async () => row,
      getLeaderboard: async () => ({ stories: [row], ingestion: null }),
    });
    const detail = await (await api.detail("123")).json();
    const list = (await (await api.list()).json()).stories[0];
    for (const response of [detail, list])
      assert.ok(validateStory(response), JSON.stringify(validateStory.errors));
    if (detail.summary) assert.equal(detail.summary.discussion_analysis, null);
    if (list.summary) assert.equal(Object.hasOwn(list.summary, "discussion_analysis"), false);
  }
});

test("analysis exports allowlist nested fields and JSON preserves untrusted text", async () => {
  const analysis = structuredClone(
    analysisFixtures.find((fixture) => fixture.id === "qualified_agreement").expected,
  );
  const hostile = '<script>alert("x")</script> [fake](javascript:alert(1))\n# heading';
  analysis.reference_claims[0].text = hostile;
  analysis.supportive_comments[0].paraphrase = hostile;
  analysis.topics[0].summary = hostile;
  for (const entry of [
    analysis,
    ...analysis.reference_claims,
    ...analysis.supportive_comments,
    ...analysis.topics,
  ])
    entry.raw_payload = "private-marker";
  const row = {
    ...story,
    summary: {
      ...story.summary,
      discussion_analysis: analysis,
      discussion_analysis_coverage: { ...coverage, comments_fingerprint: "private-marker" },
      discussion_analysis_meta: { model: "private-marker" },
      raw_comments: "private-marker",
    },
  };
  const api = storiesHandlers({
    getStory: async () => row,
    getLeaderboard: async () => ({ stories: [row], ingestion: null }),
  });
  const response = await api.detail("123");
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.text();
  assert.doesNotMatch(
    body,
    /private-marker|raw_payload|comments_fingerprint|discussion_analysis_meta|raw_comments/,
  );
  const detail = JSON.parse(body);
  assert.ok(validateStory(detail), JSON.stringify(validateStory.errors));
  assert.equal(detail.summary.discussion_analysis.reference_claims[0].text, hostile);
  assert.equal(detail.summary.discussion_analysis.supportive_comments[0].paraphrase, hostile);
  assert.equal(detail.summary.discussion_analysis.topics[0].summary, hostile);
  assert.equal(detail.summary.discussion_analysis.analyzed_at, null);
  const list = await (await api.list()).json();
  assert.equal(Object.hasOwn(list.stories[0].summary, "discussion_analysis"), false);
  row.summary.discussion_analysis_coverage = null;
  const unknown = await (await api.detail("123")).json();
  assert.equal(unknown.summary.discussion_analysis.coverage, null);
  assert.ok(validateStory(unknown), JSON.stringify(validateStory.errors));
});

test("detail declares bounded shared caching for success and safe negatives", async () => {
  const api = storiesHandlers({ getStory: async (id) => (id === "123" ? story : null) });
  assert.equal(
    (await api.detail("123")).headers.get("cache-control"),
    "public, max-age=0, s-maxage=300",
  );
  assert.equal(
    (await api.detail("124")).headers.get("cache-control"),
    "public, max-age=0, s-maxage=60",
  );
  assert.equal((await api.detail("invalid")).headers.get("cache-control"), "no-store");
});
