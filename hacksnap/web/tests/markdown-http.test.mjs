import assert from "node:assert/strict";
import { test } from "node:test";

// Run against `npm run build && npm start`, with or without a database.
const base = process.env.HACKSNAP_TEST_URL;
test("production HTTP negotiation preserves HTML, Markdown, HEAD and API formats", {skip: !base}, async () => {
  const cases = [
    ["/docs/api", "text/markdown", "text/markdown", 200, "GET"],
    ["/docs/api", "text/html", "text/html", 200, "GET"],
    ["/docs/api", "*/*", "text/html", 200, "GET"],
    ["/docs/api", "", "text/html", 200, "GET"],
    ["/docs/api", "text/markdown;q=0", "text/html", 200, "GET"],
    ["/docs/api", "text/markdown;q=0.2,text/html", "text/html", 200, "GET"],
    ["/docs/api", "text/markdown", "text/markdown", 200, "HEAD"],
    ["/story/invalid", "text/markdown", "text/markdown", 404, "GET"],
    ["/story/invalid", "text/markdown", "text/markdown", 404, "HEAD"],
    ["/openapi.json", "text/markdown", "application/vnd.oai.openapi+json", 200, "GET"],
    ["/.well-known/api-catalog", "text/markdown", "application/linkset+json", 200, "GET"],
    ["/unknown-page", "text/html", "text/html", 404, "GET"],
    ["/unknown/nested/page", "text/html", "text/html", 404, "GET"],
    ["/docs/api?page=/story/invalid", "text/markdown", "text/markdown", 200, "GET"],
  ];
  for (const [path, accept, type, status, method] of cases) {
    const response = await fetch(new URL(path, base), {headers: accept ? {Accept: accept} : {}, method});
    const label = `${method} ${path} Accept=${accept}`;
    assert.equal(response.status, status, label);
    assert.ok(response.headers.get("content-type").startsWith(type), label);
    if (type === "text/markdown") {
      assert.ok(response.headers.get("vary").toLowerCase().split(/,\s*/).includes("accept"), label);
    }
    if (path === "/docs/api") assert.match(response.headers.get("cache-control"), /no-store/, label);
    const body = await response.text();
    if (method === "HEAD") assert.equal(body, "", label);
    if (type === "text/markdown" && status === 200 && method === "GET") {
      assert.match(body, /^# Hacksnap Stories API/);
      assert.ok(!body.includes("<html"));
    }
  }
});

// Set this to a valid fixture story when testing ISR against a seeded database.
const storyId = process.env.HACKSNAP_TEST_STORY_ID;
test("story metrics are substantive HTML before JavaScript executes", {skip: !base || !storyId}, async () => {
  const response = await fetch(new URL(`/story/${storyId}`, base));
  assert.equal(response.status, 200);
  const html = await response.text();
  const section = html.match(/<section class="story-metrics"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'metrics are in the initial HTML');
  const text = section.replace(/<[^>]*>/g, '');
  for (const label of ['Skept-o-meter', 'comments', 'Peak rank',
    'Time in Top 10', 'Hacksnap ranking over time', 'Tracking since']) assert.ok(text.includes(label), label);
  assert.ok(!/\shidden(?:=|>)|display:\s*none/.test(section), 'metrics are not hidden');
});
test("synthetic stories preserve old history and distinguish pending, empty and one-point states", {skip: !base || storyId !== '90000001'}, async () => {
  for (const [id, expected, absent] of [
    ['90000006', ['Low', '12 recorded observations', 'Latest recorded rank:', 'Tracking since'], []],
    ['90000008', ['No comments', 'No usable comments available'], []],
    ['90000009', ['Analysis pending', 'Not enough history', 'One observation does not establish a trend'], []],
    ['90000010', ['Not yet recorded', 'Not enough history', 'No ranking history recorded yet'], ['Hacksnap ranking over time']],
  ]) {
    const response = await fetch(new URL(`/story/${id}`, base));
    assert.equal(response.status, 200);
    const html = await response.text();
    const section = html.match(/<section class="story-metrics"[\s\S]*?<\/section>/)?.[0];
    assert.ok(section);
    const text = section.replace(/<[^>]*>/g, '');
    for (const value of expected) assert.ok(text.includes(value), `${id}: ${value}`);
    for (const value of absent) assert.ok(!text.includes(value), `${id}: ${value}`);
  }
});
test("ISR pages keep a 30-minute TTL and negotiate Markdown after warming HTML", {skip: !base || !storyId}, async () => {
  for (const path of ["/", `/story/${storyId}`]) {
    let cachedHTML;
    for (const accept of ["text/html", "text/html", "text/markdown", "text/html"]) {
      const response = await fetch(new URL(path, base), {headers: {Accept: accept}});
      const body = await response.text();
      assert.equal(response.status, 200, `${path} ${accept}`);
      assert.ok(response.headers.get("content-type").startsWith(accept));
      if (accept === "text/html") {
        assert.match(response.headers.get("cache-control"), /\bs-maxage=1800\b/);
        if (cachedHTML) assert.equal(response.headers.get("x-nextjs-cache"), "HIT");
        assert.match(body, /<html/);
        if (cachedHTML) assert.equal(body, cachedHTML, "HTML remains cached across negotiation");
        cachedHTML = body;
      } else {
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.match(body, /^# /);
        assert.ok(!body.includes("<html"));
      }
    }
    // Client-side navigation must still return an RSC payload, not cached HTML.
    const navigation = await fetch(new URL(path, base), {headers: {RSC: "1"}});
    assert.equal(navigation.status, 200);
    assert.ok(navigation.headers.get("content-type").startsWith("text/x-component"));
    assert.ok(!(await navigation.text()).includes("<html"));
  }
});
