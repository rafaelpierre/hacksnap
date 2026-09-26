import assert from "node:assert/strict";
import {test} from "node:test";
import React, {act} from "react";
import {renderToString} from "react-dom/server";
import {createRequire} from "node:module";
const {JSDOM} = createRequire(import.meta.url)("jsdom");
import {StoryAddedTime} from "../app/story-added-time";

test("added time hydrates from UTC into the reader timezone and updates with the story", async () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  const dateTime = "2026-09-26T01:30:00.000Z";
  const html = renderToString(<StoryAddedTime dateTime={dateTime} />);
  assert.match(html, /26 Sept 2026.*01:30.*UTC/);
  const dom = new JSDOM(`<div id="root">${html}</div>`);
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  keys.forEach(key => Object.defineProperty(globalThis, key, {configurable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key]}));
  const {hydrateRoot} = await import("react-dom/client");
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  const expected = (value: string) => new Intl.DateTimeFormat(undefined, {year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short"}).format(new Date(value));
  try {
    await act(async () => { root = hydrateRoot(document.getElementById("root")!, <StoryAddedTime dateTime={dateTime} />, {onRecoverableError: error => errors.push(error)}); });
    assert.equal(document.querySelector("time")?.textContent, expected(dateTime));
    assert.equal(document.querySelector("time")?.dateTime, dateTime);
    assert.match(document.querySelector("time")!.textContent!, /25/);
    const next = "2026-12-01T10:00:00.000Z";
    await act(async () => root!.render(<StoryAddedTime dateTime={next} />));
    assert.equal(document.querySelector("time")?.textContent, expected(next));
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root?.unmount());
    dom.window.close();
    keys.forEach((key, i) => { if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!); else Reflect.deleteProperty(globalThis, key); });
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});
