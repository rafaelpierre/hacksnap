import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { canonicalArticleImage } from "../lib/article-image";
import { ArticleImage } from "../app/article-image";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const ready = {
  image_status: "ready",
  image_url: "https://store.public.blob.vercel-storage.com/articles/123.webp",
  image_width: 1200,
  image_height: 675,
  image_mime_type: "image/webp",
};

test("only a ready public Blob image enters the rendering contract", () => {
  assert.deepEqual(canonicalArticleImage(ready), {
    url: ready.image_url,
    width: 1200,
    height: 675,
    mimeType: "image/webp",
  });
  for (const image of [
    { ...ready, image_status: "pending" },
    { ...ready, image_status: "failed" },
    { ...ready, image_url: "https://publisher.example/article.jpg" },
    { ...ready, image_url: "http://store.public.blob.vercel-storage.com/article.jpg" },
    { ...ready, image_url: "https://public.blob.vercel-storage.com/article.jpg" },
    { ...ready, image_url: "https://store.public.blob.vercel-storage.com/article.jpg" },
    { ...ready, image_url: `${ready.image_url}?private=1` },
    { ...ready, image_url: `${ready.image_url}#fragment` },
    { ...ready, image_url: "not a URL" },
    {},
  ]) {
    assert.equal(canonicalArticleImage(image), null);
  }
  assert.equal(canonicalArticleImage({ ...ready, image_width: -1, image_height: 0 }), null);
  assert.equal(canonicalArticleImage({ ...ready, image_mime_type: null }), null);
});

test("a browser image error keeps the branded media space", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  keys.forEach((key) =>
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
    }),
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <ArticleImage
          image={canonicalArticleImage(ready)}
          alt="Article image for a test story"
          className="card-image"
          loading="lazy"
        />,
      ),
    );
    const image = document.querySelector("img")!;
    assert.equal(image.getAttribute("width"), "1200");
    assert.equal(image.getAttribute("height"), "675");
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.equal(image.getAttribute("decoding"), "async");
    assert.equal(image.alt, "Article image for a test story");
    await act(async () => image.dispatchEvent(new dom.window.Event("error", { bubbles: true })));
    const placeholder = document.querySelector(".card-image.article-image-unavailable");
    assert.equal(placeholder?.getAttribute("role"), "img");
    assert.match(placeholder?.getAttribute("aria-label") ?? "", /Image unavailable/);
    assert.equal((placeholder as HTMLElement).style.aspectRatio, "1200 / 675");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    keys.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test("an already failed browser image is removed after hydration", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  keys.forEach((key) =>
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
    }),
  );
  const complete = Object.getOwnPropertyDescriptor(
    dom.window.HTMLImageElement.prototype,
    "complete",
  );
  const naturalWidth = Object.getOwnPropertyDescriptor(
    dom.window.HTMLImageElement.prototype,
    "naturalWidth",
  );
  Object.defineProperties(dom.window.HTMLImageElement.prototype, {
    complete: { configurable: true, get: () => true },
    naturalWidth: { configurable: true, get: () => 0 },
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <ArticleImage
          image={canonicalArticleImage(ready)}
          alt="Article image for a test story"
          className="card-image"
          loading="eager"
        />,
      ),
    );
    assert.ok(document.querySelector(".card-image.article-image-unavailable"));
  } finally {
    await act(async () => root.unmount());
    if (complete)
      Object.defineProperty(dom.window.HTMLImageElement.prototype, "complete", complete);
    if (naturalWidth)
      Object.defineProperty(dom.window.HTMLImageElement.prototype, "naturalWidth", naturalWidth);
    dom.window.close();
    keys.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
