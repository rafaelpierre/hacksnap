import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
import { renderToString } from "react-dom/server";
import { formatStoryAge, StoryAge } from "../app/story-age";

test("story age uses compact elapsed days and hours at the hour and day boundaries", () => {
  const dateTime = "2026-09-29T12:00:00.000Z";
  const start = Date.parse(dateTime);
  for (const [hours, expected] of [
    [-1, "<1h"],
    [0, "<1h"],
    [0.99, "<1h"],
    [1, "1h"],
    [23.99, "23h"],
    [24, "1d"],
    [26, "1d 2h"],
    [53, "2d 5h"],
  ] as const) {
    assert.equal(formatStoryAge(dateTime, start + hours * 3_600_000), expected);
  }
});

test("server rendering preserves the exact timestamp with a stable UTC fallback", () => {
  const html = renderToString(<StoryAge dateTime="2026-09-29T12:00:00.000Z" />);
  assert.match(html, /dateTime="2026-09-29T12:00:00.000Z"/);
  assert.match(html, /<time class="story-age"/);
  assert.doesNotMatch(html, /<details|<summary|<svg|title=/);
  assert.match(html, /aria-label="Story added Tue, 29 Sep 2026 12:00:00 GMT"/);
  assert.match(html, />2026-09-29<\/time>/);
});

test("compact story age hydrates without mismatch and updates with the story", async () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  const dateTime = "2026-09-26T01:30:00.000Z";
  const html = renderToString(<StoryAge dateTime={dateTime} />);
  assert.match(html, />2026-09-26<\/time>/);
  const dom = new JSDOM(`<div id="root">${html}</div>`);
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  keys.forEach((key) =>
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
    }),
  );
  const { hydrateRoot } = await import("react-dom/client");
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  const expected = (value: string) => formatStoryAge(value, Date.now());
  try {
    await act(async () => {
      root = hydrateRoot(document.getElementById("root")!, <StoryAge dateTime={dateTime} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    assert.equal(document.querySelector("time")?.textContent, expected(dateTime));
    assert.equal(document.querySelector("time")?.dateTime, dateTime);
    assert.equal(document.querySelector("details, summary"), null);

    const next = "2026-12-01T10:00:00.000Z";
    await act(async () => root!.render(<StoryAge dateTime={next} />));
    assert.equal(document.querySelector("time")?.textContent, expected(next));
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root?.unmount());
    dom.window.close();
    keys.forEach((key, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
