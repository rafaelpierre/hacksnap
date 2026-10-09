import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";

test("AI agents receive Markdown without an explicit Accept preference", () => {
  for (const agent of [
    "ChatGPT-User",
    "OAI-SearchBot",
    "Claude-User",
    "Claude-SearchBot",
    "GPTBot",
    "ClaudeBot",
    "PerplexityBot",
    "Perplexity-User",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      for (const accept of [null, "*/*", "text/html"]) {
        const headers = new Headers({ "user-agent": `Mozilla/5.0 (compatible; ${agent}/1.0)` });
        if (accept) headers.set("accept", accept);
        const response = proxy(
          new NextRequest("https://hacksnap.live/story/example-123?source=test", {
            method,
            headers,
          }),
        );
        const rewrite = new URL(response.headers.get("x-middleware-rewrite"));
        assert.equal(rewrite.pathname, "/markdown");
        assert.equal(rewrite.searchParams.get("page"), "/story/example-123");
        assert.equal(rewrite.searchParams.has("source"), false);
        assert.equal(
          response.headers.get("x-middleware-request-x-hacksnap-markdown-page"),
          "/story/example-123",
        );
        assert.equal(response.headers.get("vary"), "Accept, User-Agent");
      }
    }
  }
});

test("ordinary negotiation and non-read methods retain their behavior", () => {
  for (const accept of ["*/*", "text/html", "text/markdown;q=0", "text/markdown;q=0.5,text/html"]) {
    const response = proxy(
      new NextRequest("https://hacksnap.live/", {
        headers: { accept, "user-agent": "Mozilla/5.0" },
      }),
    );
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(response.headers.get("vary"), "Accept, User-Agent");
  }
  const markdown = proxy(
    new NextRequest("https://hacksnap.live/story/123", {
      headers: { accept: "text/markdown", "user-agent": "Mozilla/5.0" },
    }),
  );
  assert.equal(new URL(markdown.headers.get("x-middleware-rewrite")).pathname, "/markdown");
  for (const method of ["POST", "OPTIONS"]) {
    const response = proxy(
      new NextRequest("https://hacksnap.live/", {
        method,
        headers: { accept: "text/markdown", "user-agent": "ChatGPT-User/1.0" },
      }),
    );
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
  }
});

test("AI Markdown preserves noindex for temporary homepage pagination", () => {
  for (const query of ["?page=2&cursor=expired", "?cursor=expired", "?cursor="]) {
    for (const method of ["GET", "HEAD"]) {
      const response = proxy(
        new NextRequest(`https://hacksnap.live/${query}`, {
          method,
          headers: { "user-agent": "ChatGPT-User/1.0" },
        }),
      );
      assert.ok(response.headers.get("x-middleware-rewrite"));
      assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
    }
  }
});

test("Latest Markdown negotiation preserves the requested page through its rewrite", () => {
  const response = proxy(
    new NextRequest("https://hacksnap.live/?page=2", {
      headers: { Accept: "text/markdown" },
    }),
  );
  const rewrite = new URL(response.headers.get("x-middleware-rewrite"));
  assert.equal(rewrite.pathname, "/markdown");
  assert.equal(rewrite.searchParams.get("page"), "/");
  assert.equal(response.headers.get("x-middleware-request-x-hacksnap-markdown-page"), "/");
  assert.equal(response.headers.get("x-middleware-request-x-hacksnap-markdown-query"), "?page=2");
  assert.equal(response.headers.get("vary"), "Accept, User-Agent");
});

test("HTML and unsupported methods keep normal routing and negotiation headers", () => {
  for (const [method, accept] of [
    ["GET", "text/html"],
    ["POST", "text/markdown"],
  ]) {
    const response = proxy(
      new NextRequest("https://hacksnap.live/", {
        method,
        headers: { Accept: accept },
      }),
    );
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("vary"), "Accept, User-Agent");
  }
});

test("AI Latest negotiation preserves pagination without excluding canonical pages from indexing", () => {
  for (const method of ["GET", "HEAD"]) {
    const response = proxy(
      new NextRequest("https://hacksnap.live/?page=2", {
        method,
        headers: { "user-agent": "ChatGPT-User/1.0", accept: "text/html" },
      }),
    );
    assert.equal(new URL(response.headers.get("x-middleware-rewrite")).pathname, "/markdown");
    assert.equal(response.headers.get("x-middleware-request-x-hacksnap-markdown-query"), "?page=2");
    assert.equal(response.headers.get("x-robots-tag"), null);
    assert.equal(response.headers.get("vary"), "Accept, User-Agent");
  }
});

test("AI agents and explicit Markdown requests leave APIs, assets and unrelated paths untouched", () => {
  for (const path of [
    "/api/stories",
    "/api/stories/123",
    "/api/browse-stories",
    "/api/ready-stories",
    "/assets/site.css",
    "/fonts/reading.woff2",
    "/_next/static/chunks/app.js",
    "/favicon.ico",
    "/icon.svg",
    "/feed.xml",
    "/openapi.json",
    "/opengraph-image",
    "/story/123/opengraph-image",
    "/unknown/path",
    "/2026/13",
    "/archive/unknown",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      for (const accept of ["application/json", "text/markdown"]) {
        const response = proxy(
          new NextRequest(`https://hacksnap.live${path}`, {
            method,
            headers: { "user-agent": "ChatGPT-User/1.0", accept },
          }),
        );
        assert.equal(response.headers.get("x-middleware-next"), "1", path);
        assert.equal(response.headers.get("x-middleware-rewrite"), null, path);
        assert.equal(response.headers.get("x-middleware-override-headers"), null, path);
        assert.equal(response.headers.get("vary"), null, path);
        assert.equal(response.headers.get("x-robots-tag"), null, path);
      }
    }
  }
});

test("recognized canonical and legacy dated feeds still negotiate AI Markdown", () => {
  for (const path of ["/2026/09", "/archive", "/archive/2026/09"]) {
    const response = proxy(
      new NextRequest(`https://hacksnap.live${path}?page=2`, {
        headers: { "user-agent": "ChatGPT-User/1.0", accept: "text/html" },
      }),
    );
    assert.equal(new URL(response.headers.get("x-middleware-rewrite")).pathname, "/markdown");
    assert.equal(response.headers.get("x-middleware-request-x-hacksnap-markdown-page"), path);
    assert.equal(response.headers.get("x-middleware-request-x-hacksnap-markdown-query"), "?page=2");
    assert.equal(response.headers.get("vary"), "Accept, User-Agent");
  }
});
