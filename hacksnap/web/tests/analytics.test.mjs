import assert from "node:assert/strict";
import {test} from "node:test";
import {createJourney, track} from "../lib/analytics.ts";

function fixture() {
  const events = [];
  let id = 0;
  const journey = createJourney((name, params) => events.push({name, ...params}), () => String(++id));
  return {events, ...journey};
}
test("browse, story, rerender, next, back: one view per route occurrence", () => {
  const j = fixture();
  for (const path of ["/", "/", "/story/1", "/story/1", "/story/2", "/story/1"]) {
    j.route(path);
    j.emit("reader_visit", {}, "visit");
    if (path.startsWith("/story/")) j.emit("story_view", {story_id: path.split("/").at(-1)}, `story:${path}`);
  }
  assert.equal(j.events.filter(e => e.name === "reader_visit").length, 4);
  assert.deepEqual(j.events.filter(e => e.name === "story_view").map(e => e.story_id), ["1", "2", "1"]);
  assert.equal(new Set(j.events.map(e => e.visit_id)).size, 4);
});
test("observer replay and repeated clicks count one exposed/clicked recommendation per visit", () => {
  const j = fixture();
  const params = {story_id: "1", target_story_id: "2", position: 1};
  j.route("/story/1");
  for (let i = 0; i < 3; i++) {
    j.emit("recommendation_exposure", params, "exposure:1:2:1");
    j.emit("recommendation_click", params, "click:1:2:1");
  }
  assert.equal(j.events.filter(e => e.name === "recommendation_exposure").length, 1);
  assert.equal(j.events.filter(e => e.name === "recommendation_click").length, 1);
  j.route("/"); j.route("/story/1");
  j.emit("recommendation_exposure", params, "exposure:1:2:1");
  assert.equal(j.events.filter(e => e.name === "recommendation_exposure").length, 2);
});
test("sharing preserves action counts but strips arbitrary content fields", () => {
  const j = fixture(); j.route("/");
  for (let i = 0; i < 2; i++) j.emit("share_menu_open", {story_id: "1", draft: "private text", url: "mailto:private"});
  j.emit("share_destination_select", {story_id: "1", destination: "X"});
  assert.equal(j.events.filter(e => e.name === "share_menu_open").length, 2);
  assert.equal(JSON.stringify(j.events).includes("private"), false);
  assert.equal(j.events.some(e => e.name.includes("success")), false);
});
test("missing browser and throwing analytics do not interrupt user actions", () => {
  assert.doesNotThrow(() => track("share_menu_open"));
  const j = createJourney(() => { throw Error("blocked"); }, () => "id");
  assert.doesNotThrow(() => { j.route("/"); j.emit("share_copy_success", {copy_kind: "link"}); });
});
test("browser calls queue before GA, dispatch to GA when available, and tolerate failure", () => {
  const previous = globalThis.window;
  try {
    globalThis.window = {location: {pathname: "/story/3"}};
    track("story_view", {story_id: "3"}, "story:3");
    assert.deepEqual(window.dataLayer.map(args => args[1]), ["reader_visit", "story_view"]);
    const sent = [];
    window.gtag = (...args) => sent.push(args);
    track("share_copy_attempt", {copy_kind: "post"});
    assert.equal(sent[0][1], "share_copy_attempt");
    window.gtag = () => { throw Error("blocked"); };
    assert.doesNotThrow(() => track("share_copy_failure", {copy_kind: "post"}));
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
