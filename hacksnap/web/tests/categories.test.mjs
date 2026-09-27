import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { CATEGORIES, categoryBySlug, categoryById, categoryURL } from "../lib/categories.ts";

test("category routes use a fixed taxonomy and canonical pagination", () => {
  assert.equal(CATEGORIES.length, 6);
  for (const category of CATEGORIES) {
    assert.equal(categoryById(category.id), categoryBySlug(category.slug));
    assert.equal(categoryURL(category, 2), `/category/${category.slug}?page=2`);
  }
  for (const slug of ["other", "__proto__", "agents_coding", "AGENTS-CODING"])
    assert.equal(categoryBySlug(slug), undefined);
  assert.equal(categoryById(null), undefined);
});
