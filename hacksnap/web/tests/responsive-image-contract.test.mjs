import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "@jest/globals";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import nextConfig from "../next.config.ts";

// Render Next's real Image implementation here. The other component tests use
// a plain img mock so they can exercise load-error handling in jsdom.
const require = createRequire(import.meta.url);
const { Image } = require("next/dist/client/image-component");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { hasRemoteMatch } = require("next/dist/shared/lib/match-remote-pattern");
const imageConfig = { ...imageConfigDefault, ...nextConfig.images };
const blobURL = "https://store.public.blob.vercel-storage.com/articles/123.webp";

function renderImage(src) {
  return renderToStaticMarkup(
    React.createElement(
      ImageConfigContext.Provider,
      { value: imageConfig },
      React.createElement(Image, {
        src,
        alt: "",
        width: 1600,
        height: 900,
        sizes: "(max-width: 640px) calc(100vw - 4rem), 18rem",
        loading: "lazy",
      }),
    ),
  );
}

test("real Next Image emits only bounded optimizer widths for the ready Blob origin", () => {
  const html = renderImage(blobURL);
  assert.match(html, /width="1600" height="900"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /sizes="\(max-width: 640px\)/);
  assert.deepEqual(
    [...new Set([...html.matchAll(/(?:\?|&amp;)w=(\d+)/g)].map((match) => Number(match[1])))],
    [128, 256, 320, 384, 640, 750, 1080, 1600],
  );
  assert.deepEqual([...new Set([...html.matchAll(/q=(\d+)/g)].map((match) => match[1]))], ["75"]);
});

test("optimizer remote pattern rejects other hosts, paths, schemes, and queries", () => {
  assert.equal(hasRemoteMatch([], imageConfig.remotePatterns, new URL(blobURL)), true);
  for (const src of [
    "https://publisher.example/articles/123.webp",
    "https://store.public.blob.vercel-storage.com/other/123.webp",
    "http://store.public.blob.vercel-storage.com/articles/123.webp",
    `${blobURL}?token=1`,
  ]) {
    assert.equal(hasRemoteMatch([], imageConfig.remotePatterns, new URL(src)), false, src);
  }
});
