import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { archiveMonth, archivePage, archiveURL, monthBounds } from "../lib/archive.ts";

test("archive routes reject ambiguous dates and pagination", () => {
  assert.equal(archiveMonth(["2026", "09"]), "2026-09");
  for (const path of [
    [],
    ["2026"],
    ["2026", "13"],
    ["2026", "9"],
    ["2026", "09", "01"],
    ["0000", "01"],
  ])
    assert.equal(archiveMonth(path), null);
  assert.equal(archivePage(undefined), 1);
  assert.equal(archivePage("2"), 2);
  for (const page of ["0", "-1", "1.5", "01", "10000000", ["1", "2"]])
    assert.equal(archivePage(page), null);
  assert.equal(archiveURL("2026-09", 2), "/archive/2026/09?page=2");
  assert.equal(archiveURL(null), "/archive");
  assert.deepEqual(monthBounds("2026-12"), [
    "2026-12-01T00:00:00.000Z",
    "2027-01-01T00:00:00.000Z",
  ]);
});
