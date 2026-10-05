import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import {
  createStoryEventHandler,
  parseStoryEvent,
  recordStoryEventSQL,
  storyEventBudget,
} from "../lib/story-events.ts";

const event = {
  kind: "view",
  story_id: "49802871",
  visit_id: "00000000-0000-4000-8000-000000000001",
};
function request(value = event, headers = {}) {
  return new Request("https://hacksnap.example/api/story-events", {
    method: "POST",
    headers: { origin: "https://hacksnap.example", "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

test("HTTP collection silently ignores unactivated tracking and deduplicates after activation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY,date_added timestamptz);
      CREATE TABLE hacksnap_popularity_state(singleton boolean PRIMARY KEY CHECK(singleton),tracking_started_at timestamptz);
      CREATE TABLE hacksnap_popularity_events(visit_id uuid,story_id bigint,kind text,PRIMARY KEY(visit_id,story_id,kind));
      CREATE TABLE hacksnap_story_popularity(story_id bigint PRIMARY KEY,historical_views bigint DEFAULT 0,story_views bigint DEFAULT 0,story_clicks bigint DEFAULT 0);
      INSERT INTO hacker_news_threads VALUES(49802871,now());
      INSERT INTO hacksnap_popularity_state VALUES(true,NULL);
      INSERT INTO hacksnap_story_popularity(story_id,historical_views) VALUES(49802871,322);`);
    const handler = createStoryEventHandler({
      enabled: () => true,
      allow: () => true,
      record: async (value) => {
        await db.query(recordStoryEventSQL, [value.visit_id, value.story_id, value.kind]);
      },
    });
    assert.equal((await handler(request())).status, 204);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hacksnap_popularity_events")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT story_views::text AS n FROM hacksnap_story_popularity")).rows[0].n,
      "0",
    );
    await db.exec(
      "UPDATE hacksnap_popularity_state SET tracking_started_at=clock_timestamp() WHERE singleton",
    );
    assert.equal((await handler(request())).status, 204);
    assert.equal((await handler(request())).status, 204);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hacksnap_popularity_events")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("SELECT story_views::text AS n FROM hacksnap_story_popularity")).rows[0].n,
      "1",
    );
  } finally {
    await db.close();
  }
}, 30000);

test("strict story-event validation never accepts URLs, unknown kinds, extra fields or invalid IDs", () => {
  assert.deepEqual(parseStoryEvent(event), event);
  for (const invalid of [
    null,
    [],
    {},
    { ...event, kind: "story_view" },
    { ...event, story_id: "/story/123" },
    { ...event, story_id: "0" },
    { ...event, story_id: "1;DROP TABLE" },
    { ...event, story_id: "1000000000000000" },
    { ...event, visit_id: "reader-email" },
    { ...event, email: "private" },
  ])
    assert.equal(parseStoryEvent(invalid), null);
});

test("handler accepts same-origin views/clicks and keeps disabled collection credential-free", async () => {
  const recorded = [];
  const handler = createStoryEventHandler({
    enabled: () => true,
    allow: () => true,
    record: async (value) => recorded.push(value),
  });
  for (const kind of ["view", "click"]) {
    const response = await handler(request({ ...event, kind }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
  }
  assert.deepEqual(
    recorded.map((value) => value.kind),
    ["view", "click"],
  );
  const disabled = createStoryEventHandler({
    enabled: () => false,
    allow: () => {
      throw new Error("unexpected");
    },
    record: async () => {
      throw new Error("unexpected");
    },
  });
  assert.equal((await disabled(request())).status, 204);
});

test("cross-origin, malformed, oversized and rate-limited events never reach the writer", async () => {
  let writes = 0;
  const handler = createStoryEventHandler({
    enabled: () => true,
    allow: () => true,
    record: async () => {
      writes++;
    },
  });
  for (const [input, status] of [
    [request(event, { origin: "https://other.example" }), 403],
    [request(event, { origin: "null" }), 403],
    [request(event, { "sec-fetch-site": "cross-site" }), 403],
    [request(event, { "content-type": "text/plain" }), 415],
    [request(event, { "content-length": "1025" }), 413],
    [request("{"), 400],
    [request({ ...event, kind: "other" }), 400],
    [request(" ".repeat(1025)), 413],
  ])
    assert.equal((await handler(input)).status, status);
  assert.equal(writes, 0);
  const rateLimited = createStoryEventHandler({
    enabled: () => true,
    allow: () => false,
    record: async () => {
      writes++;
    },
  });
  assert.equal((await rateLimited(request())).status, 429);
  const unavailable = createStoryEventHandler({
    enabled: () => true,
    allow: () => true,
    record: async () => {
      throw new Error("private-password");
    },
  });
  const response = await unavailable(request());
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
});

test("anonymous burst budget is bounded and recovers after the minute window", () => {
  let time = 1;
  const allow = storyEventBudget(() => time, 2);
  assert.equal(allow(), true);
  assert.equal(allow(), true);
  assert.equal(allow(), false);
  time += 60_000;
  assert.equal(allow(), true);
});
