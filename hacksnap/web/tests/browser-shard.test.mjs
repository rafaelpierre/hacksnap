import { describe, expect, test } from "@jest/globals";
import { selectTests } from "../scripts/browser-shard.mjs";

const tests = ["quick", "layout", "history", "visual"].flatMap((file) =>
  Array.from({ length: 12 }, (_, index) => `[chromium] › ${file}.spec.ts:10:3 › case ${index}`),
);
const listing = `Listing tests:\n${tests.map((test) => `  ${test}`).join("\n")}\nTotal: 48 tests`;

describe("Chromium shard selection", () => {
  test("partitions the complete discovered suite without omissions or duplicates", () => {
    const shards = Array.from(
      { length: 6 },
      (_, index) => selectTests(listing, `${index + 1}/6`).selected,
    );
    expect(shards.flat().sort()).toEqual([...tests].sort());
    for (const shard of shards) {
      expect(shard).toHaveLength(8);
      for (const file of ["quick", "layout", "history", "visual"])
        expect(shard.filter((test) => test.includes(`${file}.spec.ts`))).toHaveLength(2);
    }
  });

  test("includes newly discovered tests and keeps selection deterministic", () => {
    const added = "[chromium] › new.spec.ts:3:1 › new regression";
    const list = `${listing}\n${added}`;
    expect(selectTests(list, "1/6")).toEqual(selectTests(list, "1/6"));
    const selected = Array.from(
      { length: 6 },
      (_, index) => selectTests(list, `${index + 1}/6`).selected,
    ).flat();
    expect(selected.sort()).toEqual([...tests, added].sort());
  });

  test("rejects invalid shard configuration and empty selections", () => {
    for (const shard of ["0/6", "7/6", "1/0", "1", "1.5/6", "49/49", undefined])
      expect(() => selectTests(listing, shard)).toThrow();
    expect(() => selectTests("Total: 0 tests", "1/6")).toThrow();
    expect(() => selectTests(`${listing}\n${tests[0]}`, "1/6")).toThrow();
  });
});
