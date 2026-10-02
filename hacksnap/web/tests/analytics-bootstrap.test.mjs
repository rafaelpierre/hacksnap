import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { JSDOM } from "jsdom";
import { analyticsBootstrap } from "../lib/analytics-bootstrap.ts";

for (const eventName of ["pointerdown", "keydown", "scroll"]) {
  test(`Google tag waits for ${eventName} and loads only once`, () => {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
      url: "https://hacksnap.live/",
      runScripts: "outside-only",
    });
    try {
      const { window } = dom;
      window.eval(analyticsBootstrap);
      const scripts = () =>
        window.document.querySelectorAll(
          'script[src="https://www.googletagmanager.com/gtag/js?id=G-059PVYBN82"]',
        );
      assert.equal(scripts().length, 0);
      assert.deepEqual(
        Array.from(window.dataLayer, (args) => args[0]),
        ["js", "config"],
      );
      window.gtag("event", "reader_visit", { visit_id: "one" });
      assert.equal(window.dataLayer[2][1], "reader_visit");

      window.dispatchEvent(new window.Event(eventName));
      assert.equal(scripts().length, 1);
      assert.equal(scripts()[0].async, true);
      window.dispatchEvent(new window.Event(eventName));
      window.dispatchEvent(new window.Event("scroll"));
      assert.equal(scripts().length, 1);
      assert.equal(window.dataLayer.length, 3);
    } finally {
      dom.window.close();
    }
  });
}
