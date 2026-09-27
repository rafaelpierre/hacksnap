import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { ThemeToggle } from "../app/theme-toggle";
import { THEME_STORAGE_KEY } from "../lib/theme";
const { JSDOM } = createRequire(import.meta.url)("jsdom");

for (const systemDark of [true, false]) {
  for (const saved of ["light", "dark", null, "invalid"]) {
    test(`mount restores ${saved} with ${systemDark ? "dark" : "light"} OS appearance and survives remount`, async () => {
      await withToggle({ saved, systemDark }, async (render) => {
        await render();
        const expected = saved === "light" || saved === "dark" ? saved : "system";
        assert.equal(document.documentElement.dataset.theme, expected);
        const dark = expected === "dark" || (expected === "system" && systemDark);
        assert.equal(
          document.querySelector("button")!.getAttribute("aria-label"),
          `Switch to ${dark ? "light" : "dark"} mode`,
        );
        await act(async () => document.querySelector("button")!.click());
        const selected = dark ? "light" : "dark";
        assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), selected);
        assert.equal(document.documentElement.dataset.theme, selected);
        // A new document/hydration can start from the server's system attribute.
        document.documentElement.dataset.theme = "system";
        await render();
        assert.equal(document.documentElement.dataset.theme, selected);
        assert.equal(
          document.querySelector("button")!.getAttribute("aria-label"),
          `Switch to ${dark ? "dark" : "light"} mode`,
        );
      });
    });
  }
}

test("blocked storage preserves the early theme and still permits toggling", async () => {
  await withToggle({ saved: "light", systemDark: true, blocked: true }, async (render) => {
    document.documentElement.dataset.theme = "light";
    await render();
    assert.equal(document.documentElement.dataset.theme, "light");
    await act(async () => document.querySelector("button")!.click());
    assert.equal(document.documentElement.dataset.theme, "dark");
  });
});

test("preferences still synchronize across tabs and reset when storage is cleared", async () => {
  await withToggle({ saved: "light", systemDark: true }, async (render) => {
    await render();
    for (const value of ["dark", null]) {
      await act(async () =>
        window.dispatchEvent(
          new window.StorageEvent("storage", {
            key: value === null ? null : THEME_STORAGE_KEY,
            newValue: value,
            storageArea: window.localStorage,
          }),
        ),
      );
      assert.equal(document.documentElement.dataset.theme, value ?? "system");
    }
  });
});

async function withToggle(
  options: { saved: string | null; systemDark: boolean; blocked?: boolean },
  run: (render: () => Promise<void>) => Promise<void>,
) {
  const dom = new JSDOM('<html data-theme="system"><body><div id="root"></div></body></html>', {
    url: "https://hacksnap.live",
  });
  if (options.saved !== null) dom.window.localStorage.setItem(THEME_STORAGE_KEY, options.saved);
  dom.window.matchMedia = () => ({
    matches: options.systemDark,
    addEventListener() {},
    removeEventListener() {},
  });
  if (options.blocked)
    Object.defineProperty(dom.window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  // The component also uses the browser's global localStorage when saving.
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    get: () => dom.window.localStorage,
    configurable: true,
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let key = 0;
  try {
    await run(async () => {
      await act(async () => root.render(<ThemeToggle key={key++} />));
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((name, i) => {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
      else Reflect.deleteProperty(globalThis, name);
    });
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
