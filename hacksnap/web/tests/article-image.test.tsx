import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { canonicalArticleImage } from "../lib/article-image";
import { ArticleImage } from "../app/article-image";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const ready = {
  image_status: "ready",
  image_url: "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/articles/123.webp",
  image_width: 1200,
  image_height: 675,
  image_mime_type: "image/webp",
};

test("only a ready Hacksnap Blob image enters the rendering contract", () => {
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
    { ...ready, image_url: "https://unrelated.public.blob.vercel-storage.com/articles/123.webp" },
    { ...ready, image_url: ready.image_url.replace("https://", "https://sub.") },
    { ...ready, image_url: ready.image_url.replace(".com/", ".com.evil.example/") },
    { ...ready, image_url: ready.image_url.replace(".com/", ".com:8443/") },
    { ...ready, image_url: "http://caiasssg5nuaa1i1.public.blob.vercel-storage.com/article.jpg" },
    { ...ready, image_url: "https://public.blob.vercel-storage.com/article.jpg" },
    { ...ready, image_url: "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/article.jpg" },
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

test("a browser image error removes the image and its wrapper", async () => {
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
          sizes="256px"
        />,
      ),
    );
    const image = document.querySelector("img")!;
    assert.equal(image.getAttribute("width"), "1200");
    assert.equal(image.getAttribute("height"), "675");
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.equal(image.getAttribute("sizes"), "256px");
    assert.equal(image.getAttribute("decoding"), "async");
    assert.equal(image.alt, "Article image for a test story");
    await act(async () => image.dispatchEvent(new dom.window.Event("error", { bubbles: true })));
    assert.equal(document.getElementById("root")!.innerHTML, "");
    await act(async () =>
      root.render(
        <ArticleImage
          image={canonicalArticleImage(ready)}
          alt=""
          className="card-image"
          loading="lazy"
          sizes="256px"
        />,
      ),
    );
    assert.equal(document.getElementById("root")!.innerHTML, "");
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
          sizes="256px"
          fetchPriority="high"
        />,
      ),
    );
    assert.equal(document.getElementById("root")!.innerHTML, "");
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

test("loaded images under 2 KiB disappear; unknown sizes remain visible", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const originalFetch = globalThis.fetch;
  keys.forEach((key) =>
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
    }),
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    for (const length of [
      "0",
      "365",
      "1428",
      "2047",
      "2048",
      "50000",
      null,
      "",
      "-1",
      "bad",
      "network-error",
      "http-error",
    ]) {
      let calls = 0;
      let signal: AbortSignal | null | undefined;
      const url = `${ready.image_url.slice(0, -5)}-${length}.webp`;
      globalThis.fetch = async (input, options) => {
        calls += 1;
        assert.equal(input, url);
        assert.equal(options?.method, "HEAD");
        signal = options?.signal;
        if (length === "network-error") throw new TypeError("Failed to fetch");
        return new Response(null, {
          status: length === "http-error" ? 503 : 200,
          headers: length === null ? {} : { "content-length": length },
        });
      };
      await act(async () =>
        root.render(
          <ArticleImage
            image={canonicalArticleImage({ ...ready, image_url: url })}
            alt="Test image"
            className="card-image"
            loading="lazy"
            sizes="256px"
          />,
        ),
      );
      assert.equal(calls, 0, "lazy images are not checked before loading");
      const image = document.querySelector("img")!;
      Object.defineProperty(image, "naturalWidth", { value: 256, configurable: true });
      await act(async () => image.dispatchEvent(new dom.window.Event("load")));
      assert.equal(calls, 1);
      const rejected = length !== null && /^\d+$/.test(length) && Number(length) < 2048;
      assert.equal(document.querySelector(".card-image") === null, rejected, String(length));
      await act(async () => image.dispatchEvent(new dom.window.Event("load")));
      assert.equal(calls, 1, "repeated load events do not repeat the request");
      await act(async () => root.render(null));
      assert.equal(signal?.aborted, true);
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
    keys.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
