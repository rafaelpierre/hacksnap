import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { THEME_STORAGE_KEY, themeInitScript, themePreference } from "../lib/theme.ts";

function boot(saved, blocked = false) {
  const dataset = {theme: "system"};
  const context = {document: {documentElement: {dataset}}};
  Object.defineProperty(context, "localStorage", {get() {
    if (blocked) throw new Error("Storage is disabled");
    return {getItem(key) {
      assert.equal(key, THEME_STORAGE_KEY);
      return saved;
    }};
  }});
  runInNewContext(themeInitScript, context);
  return dataset.theme;
}

for (const saved of ["light", "dark", "system"]) {
  test(`saved ${saved} preference is applied before hydration`, () => {
    assert.equal(boot(saved), saved);
    assert.equal(themePreference(saved), saved);
  });
}
for (const saved of [null, "", "invalid", "LIGHT"]) {
  test(`missing or invalid preference (${JSON.stringify(saved)}) follows the OS`, () => {
    assert.equal(boot(saved), "system");
    assert.equal(themePreference(saved), "system");
  });
}
test("blocked storage still enables system appearance before hydration", () => {
  assert.equal(boot(null, true), "system");
});
test("a failed storage read does not stop page initialization", () => {
  const dataset = {};
  runInNewContext(themeInitScript, {
    document: {documentElement: {dataset}},
    localStorage: {getItem() { throw new Error("Read denied"); }},
  });
  assert.equal(dataset.theme, "system");
});

// Guard semantic foreground/background pairs as component styles evolve.
const {readFileSync} = await import("node:fs");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const colors = Object.fromEntries([...css.matchAll(/(--[\w-]+): light-dark\((#[0-9a-f]+), (#[0-9a-f]+)\)/g)]
  .map(([, name, light, dark]) => [name, {light, dark}]));
function luminance(hex) {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map(c => c + c).join("") : digits;
  const rgb = full.match(/../g).map(c => parseInt(c, 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (high + .05) / (low + .05);
}
for (const theme of ["light", "dark"]) {
  test(`${theme} reading, metadata and accent colors meet normal-text contrast`, () => {
    for (const foreground of ["--ink", "--prose", "--muted", "--accent", "--positive"]) {
      for (const background of ["--bg", "--surface", "--row-hover", "--accent-soft"]) {
        const ratio = contrast(colors[foreground][theme], colors[background][theme]);
        assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }
  });
  test(`${theme} control boundaries and focus accents meet non-text contrast`, () => {
    for (const foreground of ["--control-line", "--accent"]) {
      for (const background of ["--bg", "--surface", "--row-hover"]) {
        assert.ok(contrast(colors[foreground][theme], colors[background][theme]) >= 3);
      }
    }
  });
}

test("category labels keep normal-text contrast in both themes, including hover", () => {
  const pairs = [...css.matchAll(/\[data-color="(\w+)"\] \{ --category-color: light-dark\((#[0-9a-f]+), (#[0-9a-f]+)\)/g)];
  const tints = [...css.matchAll(/color-mix\(in srgb, var\(--category-color\) (\d+)%, var\(--bg\)\)/g)]
    .map(match => Number(match[1]) / 100);
  assert.equal(pairs.length, 6);
  assert.equal(tints.length, 2);
  for (const [, category, light, dark] of pairs) {
    for (const [theme, foreground] of [["light", light], ["dark", dark]]) {
      const rgb = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16));
      const fg = rgb(foreground), bg = rgb(colors["--bg"][theme]);
      for (const tint of tints) {
        const mixed = "#" + bg.map((c, i) => Math.round(c * (1 - tint) + fg[i] * tint)
          .toString(16).padStart(2, "0")).join("");
        const ratio = contrast(foreground, mixed);
        assert.ok(ratio >= 4.5, `${theme} ${category} at ${tint}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
