import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";

test("homepage pagination is noindex for HTML and Markdown GET/HEAD, regardless of cursor validity", () => {
  for (const accept of ["text/html", "text/markdown"]) {
    for (const method of ["GET", "HEAD"]) {
      for (const query of [
        "page=4&cursor=frozen_selection",
        "page=4",
        "page=1&cursor=expired_selection",
        "cursor=expired_selection",
        "page=",
        "cursor=",
        "page=1&page=4",
      ]) {
        const response = proxy(
          new NextRequest(`https://hacksnap.live/?${query}`, { method, headers: { accept } }),
        );
        assert.equal(response.headers.get("X-Robots-Tag"), "noindex, follow");
        assert.equal(response.headers.get("Vary"), "Accept, User-Agent");
        assert.equal(response.headers.has("x-middleware-rewrite"), accept === "text/markdown");
      }
    }
  }
});

test("clean homepage, tracking queries, and other routes keep their indexing behavior", () => {
  for (const path of [
    "/",
    "/?utm_source=google",
    "/story/123?page=4",
    "/docs/api?cursor=example",
  ]) {
    for (const accept of ["text/html", "text/markdown"]) {
      const response = proxy(
        new NextRequest(`https://hacksnap.live${path}`, { headers: { accept } }),
      );
      assert.equal(response.headers.get("X-Robots-Tag"), null, path);
      assert.equal(response.headers.get("Vary"), "Accept, User-Agent");
    }
  }
});
