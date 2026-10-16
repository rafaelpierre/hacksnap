import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { JSDOM } from "jsdom";
import { createArticleReader } from "../lib/article-reading.ts";
import { captureReadingVisit, createJourney } from "../lib/analytics.ts";

function fixture() {
  const dom = new JSDOM(
    '<article><header data-reading-section="opening" data-reading-id="opening_1" data-reading-words="12"></header><details><summary data-reading-section="theme_heading" data-reading-id="theme_heading_1"></summary><div data-reading-section="theme_body" data-reading-id="theme_body_1"></div></details></article>',
  );
  const doc = dom.window.document;
  let time = 0;
  let focused = true;
  let hidden = false;
  let onscreen = new Set(["opening_1"]);
  Object.defineProperty(doc, "hasFocus", { value: () => focused });
  Object.defineProperty(doc, "visibilityState", { get: () => (hidden ? "hidden" : "visible") });
  function geometry() {
    for (const el of doc.querySelectorAll("[data-reading-id]"))
      el.getBoundingClientRect = () => {
        const top = onscreen.has(el.dataset.readingId) ? 0 : 2000;
        return { top, bottom: top + 100, left: 0, right: 300, width: 300, height: 100 };
      };
  }
  geometry();
  const events = [];
  const dedup = new Set();
  const reader = createArticleReader(
    doc.querySelector("article"),
    (name, fields = {}, once) => {
      if (once && dedup.has(once)) return;
      if (once) dedup.add(once);
      events.push({ name, ...fields });
    },
    () => time,
  );
  reader.start();
  const tick = (ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      time += Math.min(250, ms - elapsed);
      reader.tick();
    }
  };
  return {
    dom,
    doc,
    reader,
    events,
    tick,
    geometry,
    count: (name, id) =>
      events.filter((e) => e.name === name && (!id || e.section_id === id)).length,
    show: (...ids) => {
      onscreen = new Set(ids);
      reader.activity();
    },
    focus: (value) => {
      focused = value;
      reader.flush("blur");
    },
    hide: (value) => {
      hidden = value;
      if (value) reader.flush("hidden");
      else reader.activity();
    },
    jump: (ms) => {
      time += ms;
      reader.tick();
    },
  };
}

test("requires continuous exposure, measures cumulative dwell, and caps idle time", () => {
  const f = fixture();
  try {
    f.tick(750);
    f.show();
    f.tick(500);
    assert.equal(f.count("article_section_view"), 0);
    f.show("opening_1");
    f.tick(1000);
    assert.equal(f.count("article_section_view", "opening_1"), 1);
    f.tick(5000);
    assert.equal(f.count("article_section_engaged", "opening_1"), 1);
    f.tick(70_000);
    f.reader.flush("hidden");
    const total = f.events.filter((e) => e.name === "article_section_time").at(-1).visible_ms;
    assert.equal(total, 60_750);
    f.tick(10_000);
    f.reader.flush("hidden");
    assert.equal(
      f.events.filter((e) => e.name === "article_section_time").at(-1).visible_ms,
      total,
    );
    f.reader.activity();
    f.tick(1000);
    f.reader.flush("hidden");
    assert.equal(
      f.events.filter((e) => e.name === "article_section_time").at(-1).visible_ms,
      total + 1000,
    );
  } finally {
    f.dom.window.close();
  }
});

test("hidden, unfocused, collapsed and suspended content earns no reading time", () => {
  const f = fixture();
  try {
    f.show("theme_heading_1", "theme_body_1");
    f.tick(1500);
    assert.equal(f.count("article_section_view", "theme_heading_1"), 1);
    assert.equal(f.count("article_section_view", "theme_body_1"), 0);
    f.doc.querySelector("details").open = true;
    f.reader.activity();
    f.tick(1000);
    assert.equal(f.count("article_section_view", "theme_body_1"), 1);
    f.hide(true);
    f.tick(10_000);
    f.hide(false);
    f.focus(false);
    f.tick(10_000);
    f.focus(true);
    f.jump(120_000);
    f.reader.flush("hidden");
    const body = f.events.filter(
      (e) => e.name === "article_section_time" && e.section_id === "theme_body_1",
    );
    assert.equal(body.at(-1).visible_ms, 1000);
  } finally {
    f.dom.window.close();
  }
});

test("tall sections qualify, late sections get eligible denominators, and replay preserves totals", () => {
  const f = fixture();
  try {
    f.doc.querySelector("header").getBoundingClientRect = () => ({
      top: -100,
      bottom: 2900,
      left: 0,
      right: 300,
      height: 3000,
      width: 300,
    });
    f.tick(1000);
    assert.equal(f.count("article_section_view", "opening_1"), 1);
    f.reader.flush("route");
    f.reader.stop();
    f.reader.start();
    f.tick(1000);
    f.reader.flush("hidden");
    assert.equal(f.count("article_reading_start"), 1);
    assert.equal(f.count("article_section_view", "opening_1"), 1);
    assert.equal(f.events.filter((e) => e.name === "article_section_time").at(-1).visible_ms, 2000);
    f.doc
      .querySelector("article")
      .insertAdjacentHTML(
        "beforeend",
        '<section data-reading-section="related" data-reading-id="related_1"></section>',
      );
    f.geometry();
    f.tick(250);
    assert.equal(f.count("article_section_available", "related_1"), 1);
    assert.equal(f.count("article_section_view", "related_1"), 0);
  } finally {
    f.dom.window.close();
  }
});

test("late reading flushes retain their visit and strip content after navigation", () => {
  const events = [];
  let id = 0;
  const journey = createJourney(
    (name, fields) => events.push({ name, ...fields }),
    () => String(++id),
  );
  journey.route("/story/1");
  const first = journey.capture();
  journey.route("/story/2");
  first.emit("article_reading_checkpoint", { story_id: "1", active_ms: 1000, draft: "private" });
  assert.equal(events.at(-1).visit_id, "1");
  assert.equal(events.at(-1).story_id, "1");
  assert.equal(JSON.stringify(events).includes("private"), false);
  assert.equal(journey.capture().visitId, "2");
});

test("route cleanup cannot discover the destination DOM as part of the old article", () => {
  const f = fixture();
  try {
    f.tick(1000);
    f.doc.querySelector("article").innerHTML =
      '<section data-reading-section="pending" data-reading-id="pending_1"></section>';
    f.reader.flush("route");
    assert.equal(f.count("article_section_available", "pending_1"), 0);
    assert.equal(f.events.at(-1).furthest_section, "opening_1");
  } finally {
    f.dom.window.close();
  }
});

test("unavailable browser APIs disable observation without breaking article rendering", () => {
  assert.equal(captureReadingVisit({}), null);
  let fail = true;
  const events = [];
  const journey = createJourney(
    (name, fields) => events.push({ name, ...fields }),
    () => {
      if (fail) throw new Error("UUID unavailable");
      return "recovered";
    },
  );
  assert.throws(() => journey.route("/story/1"));
  fail = false;
  journey.route("/story/1");
  assert.equal(events[0].visit_id, "recovered");
});
