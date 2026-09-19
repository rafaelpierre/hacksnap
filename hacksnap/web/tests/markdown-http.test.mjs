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
