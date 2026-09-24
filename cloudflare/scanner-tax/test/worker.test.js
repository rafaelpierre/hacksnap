import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.js";

test("scanner probes return 402 without contacting the origin", async t => {
  const origin = t.mock.method(globalThis, "fetch", () => {
    throw new Error("A scanner probe reached the origin");
  });
  const paths = [
    "/.bashrc", "/.zshrc", "/.bash_profile", "/.zprofile",
    "/AGENT.md", "/AGENTS.md", "/GEMINI.md", "/QWEN.md",
    "/backend/.env", "/.env", "/.env.local", "/a/.env.production",
    "/wp-admin.php", "/wp-login.php", "/wp-config.php",
    "/wp-admin", "/wp-admin/", "/wp-admin/index.php", "/blog/wp-login.php",
    "/.%65nv", "/BACKEND/.ENV", "//backend///.env", "/backend%2f.env",
    "/%41GENT.md", "/GEMINI.md/", "/.env?download=1",
    "/.env/%invalid",
  ];
  for (const path of paths) {
    const response = await worker.fetch(new Request(`https://hacksnap.live${path}`));
    assert.equal(response.status, 402, path);
    assert.equal(response.headers.get("X-Scanner-Tax"), "unpaid");
    assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
    assert.match(await response.text(), /SCANNER TAX INVOICE/);
  }
  assert.equal(origin.mock.callCount(), 0);
});

test("HEAD has the same status and headers but no body; POST and OPTIONS are blocked", async t => {
  const origin = t.mock.method(globalThis, "fetch", () => {
    throw new Error("A scanner probe reached the origin");
  });
  const get = await worker.fetch(new Request("https://hacksnap.live/.env"));
  for (const method of ["HEAD", "POST", "OPTIONS"]) {
    const response = await worker.fetch(new Request("https://hacksnap.live/.env", { method }));
    assert.equal(response.status, 402);
    assert.deepEqual([...response.headers], [...get.headers]);
    if (method === "HEAD") {
      assert.equal(response.body, null);
      assert.equal(await response.text(), "");
    }
  }
  assert.equal(origin.mock.callCount(), 0);
});

test("legitimate paths and query strings reach the origin unchanged", async t => {
  const paths = [
    "/", "/story/12345678", "/feed.xml", "/robots.txt", "/sitemap.xml",
    "/api/stories", "/openapi.json", "/markdown", "/.well-known/security.txt",
    "/_next/static/app.js", "/category/ai", "/archive", "/llms.txt",
    "/search?path=/.env", "/environment", "/.environment", "/wp-administrator",
    "/docs/agent.md.html", "/about/%invalid",
  ];
  for (const path of paths) {
    const request = new Request(`https://hacksnap.live${path}`, {
      headers: { Accept: "text/markdown", Cookie: "session=example" },
    });
    const expected = new Response("origin body", { status: 203, headers: { "X-Origin": "yes" } });
    const origin = t.mock.method(globalThis, "fetch", async received => {
      assert.equal(received, request, path);
      return expected;
    });
    assert.equal(await worker.fetch(request), expected, path);
    assert.equal(origin.mock.callCount(), 1);
    origin.mock.restore();
  }
});

test("forwarding preserves POST bodies and origin redirects", async t => {
  const request = new Request("https://hacksnap.live/api/example?x=1", {
    method: "POST", body: "original payload", headers: { "Content-Type": "text/plain" },
  });
  const expected = new Response(null, { status: 307, headers: { Location: "/next" } });
  t.mock.method(globalThis, "fetch", async received => {
    assert.equal(received, request);
    assert.equal(received.method, "POST");
    assert.equal(await received.text(), "original payload");
    return expected;
  });
  assert.equal(await worker.fetch(request), expected);
});

test("reflected paths are bounded, sanitized, and exclude query strings", async () => {
  const response = await worker.fetch(new Request(
    `https://hacksnap.live/.env/%0A%09%1B%00%E2%80%AE${"x".repeat(500)}?token=secret`,
  ));
  const body = await response.text();
  assert.match(body, /\/\.env\/\?{5}/);
  assert.doesNotMatch(body, /[\x00\x1b\u202e]|token=secret|x{201}/);
});
