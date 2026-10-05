import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { HOME_FEED_CHECKPOINT_KEY, clearHomeFeedCheckpoint } from "../lib/home-feed-checkpoint.ts";

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("retiring the ranked checkpoint only clears its own browser key", () => {
  const values = new Map([
    [HOME_FEED_CHECKPOINT_KEY, "old selection"],
    ["unrelated", "keep"],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { removeItem: (key) => values.delete(key) },
  });
  assert.equal(clearHomeFeedCheckpoint(), true);
  assert.equal(values.has(HOME_FEED_CHECKPOINT_KEY), false);
  assert.equal(values.get("unrelated"), "keep");
});

test("blocked checkpoint cleanup leaves browsing available", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw Error("blocked");
    },
  });
  assert.equal(clearHomeFeedCheckpoint(), false);
});
