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
    new NextRequest("https://hacksnap.live/docs/api", {
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
  for (const query of ["?page=2", "?cursor=expired", "?page="]) {
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
