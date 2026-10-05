import assert from "node:assert/strict";
import { test } from "@jest/globals";

// Guard semantic foreground/background pairs as component styles evolve.
const { readFileSync } = await import("node:fs");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const colors = Object.fromEntries(
  [...css.matchAll(/(--[\w-]+): (#[0-9a-f]+);/g)].map(([, name, color]) => [name, color]),
);
function luminance(hex) {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  const rgb = full
    .match(/../g)
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}
test("reading, metadata and accent colors meet normal-text contrast", () => {
  for (const foreground of ["--ink", "--prose", "--muted", "--accent", "--positive"]) {
    for (const background of ["--bg", "--surface", "--row-hover", "--accent-soft"]) {
      const ratio = contrast(colors[foreground], colors[background]);
      assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
});
test("control boundaries and focus accents meet non-text contrast", () => {
  for (const foreground of ["--control-line", "--accent"]) {
    for (const background of ["--bg", "--surface", "--row-hover"]) {
      assert.ok(contrast(colors[foreground], colors[background]) >= 3);
    }
  }
});

test("category labels keep normal-text contrast including hover", () => {
  const pairs = [...css.matchAll(/\[data-color="(\w+)"\]\s*\{\s*--category-color: (#[0-9a-f]+);/g)];
  const tints = [
    ...css.matchAll(/color-mix\(in srgb, var\(--category-color\) (\d+)%, var\(--bg\)\)/g),
  ].map((match) => Number(match[1]) / 100);
  assert.equal(pairs.length, 6);
  assert.equal(tints.length, 2);
  for (const [, category, foreground] of pairs) {
    const rgb = (hex) =>
      hex
        .slice(1)
        .match(/../g)
        .map((c) => parseInt(c, 16));
    const fg = rgb(foreground),
      bg = rgb(colors["--bg"]);
    for (const tint of tints) {
      const mixed =
        "#" +
        bg
          .map((c, i) =>
            Math.round(c * (1 - tint) + fg[i] * tint)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
      const ratio = contrast(foreground, mixed);
      assert.ok(ratio >= 4.5, `${category} at ${tint}: ${ratio.toFixed(2)}:1`);
    }
  }
});
