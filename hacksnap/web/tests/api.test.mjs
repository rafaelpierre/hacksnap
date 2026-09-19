import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { storiesHandlers } from "../lib/stories-api.ts";
import { GET, HEAD } from "../app/.well-known/api-catalog/route.ts";

test("catalog advertises the actual API, spec and documentation; HEAD supports discovery", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/linkset\+json/);
  const {linkset} = await response.json();
  const api = linkset.find(entry => entry["service-desc"]);
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
  hn_id: "123", title: "Example", url: "https://example.com", points: 2,
  comment_count: 1, date_added: new Date("2026-09-19T12:00:00Z"),
  summary: {article_summary: null, discussion_summary: "Discussion", overall_takeaway: "Takeaway", model: "private-extra"},
  internal_diagnostics: "must never be exposed",
};

test("list and detail expose only documented fields and preserve pending summaries", async () => {
  const api = storiesHandlers({
    getLeaderboard: async () => ({stories: [story, {...story, hn_id: "124", summary: null}], ingestion: null}),
    getStory: async () => story,
  });
  const list = await (await api.list()).json();
  assert.equal(list.ingestion, null);
  assert.equal(list.stories[1].summary, null);
  assert.equal(list.stories[0].date_added, "2026-09-19T12:00:00.000Z");
  assert.equal(list.stories[0].internal_diagnostics, undefined);
  assert.equal(list.stories[0].summary.model, undefined);
  assert.deepEqual(await (await api.detail("123")).json(), list.stories[0]);
});

test("invalid IDs do not reach data access; missing stories return 404", async () => {
  let reads = 0;
  const api = storiesHandlers({getStory: async () => { reads++; return null; }});
  for (const id of ["0", "01", "-1", "1.5", "abc", "1 OR 1=1", "1000000000000000"]) {
    assert.equal((await api.detail(id)).status, 400);
  }
  assert.equal(reads, 0);
  assert.equal((await api.detail("999999999999999")).status, 404);
  assert.equal(reads, 1);
});

test("empty lists succeed and database failures return sanitized, uncacheable 503s", async () => {
  const empty = storiesHandlers({getLeaderboard: async () => ({stories: [], ingestion: null})});
  assert.deepEqual(await (await empty.list()).json(), {stories: [], ingestion: null});
  const fail = async () => { throw new Error("postgres://secret-credentials"); };
  const api = storiesHandlers({getLeaderboard: fail, getStory: fail});
  for (const response of [await api.list(), await api.detail("123")]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {error: "Stories are temporarily unavailable"});
  }
});
