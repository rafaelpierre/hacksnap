import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
import { test } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscussionAnalysis } from "../app/discussion-analysis";
import type {
  DiscussionAnalysis as Analysis,
  DiscussionAnalysisCoverage,
} from "../lib/discussion-analysis";

const fixtures: { id: string; expected: Analysis }[] = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url), "utf8"),
);
const coverage: DiscussionAnalysisCoverage = {
  stored_comments: 24,
  included_comments: 12,
  comments_truncated: true,
  selection_method: "active_branches_with_ancestors_v1",
};
function render(analysis: Analysis, extra = {}) {
  const document: Document = new JSDOM().window.document;
  document.body.innerHTML = renderToStaticMarkup(
    createElement(DiscussionAnalysis, {
      analysis,
      coverage,
      analyzedAt: "2026-09-27T12:00:00Z",
      ...extra,
    }),
  );
  return document;
}
function fixture(id: string) {
  return fixtures.find((item) => item.id === id)!.expected;
}

for (const { id, expected: analysis } of fixtures) {
  test(`shared discussion fixture: ${id}`, () => {
    const document = render(analysis);
    const text = document.body.textContent!;
    assert.doesNotMatch(text, /pending|consensus|Low skepticism/i);
    assert.equal(document.querySelector("h2")?.textContent, "Discussion themes");
    assert.equal(document.querySelectorAll(".analysis-group, .analysis-highlights").length, 0);
    for (const topic of analysis.topics) {
      const detail = [...document.querySelectorAll("details")].find(
        (item) => item.querySelector("summary")?.textContent === topic.title,
      );
      assert.ok(detail, "every theme has a native keyboard disclosure");
      assert.ok(detail.textContent?.includes(topic.summary));
      for (const id of topic.comment_ids) {
        const link: Element | null = detail
          .closest(".analysis-theme")!
          .querySelector(`a[href="https://news.ycombinator.com/item?id=${id}"]`);
        assert.ok(link?.getAttribute("aria-label")?.includes(topic.title));
      }
    }
    if (analysis.status === "no_comments") assert.match(text, /No usable comments were available/);
    if (!analysis.topics.length && analysis.status !== "no_comments")
      assert.match(text, /No distinct themes were identified/);
  });
}

test("historical stance examples stay hidden when themes render", () => {
  const analysis = {
    ...fixture("one_sided_criticism"),
    supportive_comments: fixture("qualified_agreement").supportive_comments,
  };
  const document = render(analysis);
  assert.doesNotMatch(
    document.body.textContent!,
    /Most critical|Most supportive|Agrees with reservations|Claim addressed/,
  );
  assert.equal(document.querySelectorAll(".analysis-highlights > li").length, 0);
});

test("coverage uses discussion counts and an explicit UTC timestamp", () => {
  const document = render(fixture("one_sided_criticism"));
  assert.match(document.body.textContent!, /12 comments analyzed/);
  assert.match(document.body.textContent!, /12 of 24 usable stored comments/);
  assert.match(document.body.textContent!, /27 Sept 2026, 12:00 UTC/);
  assert.equal(
    document.querySelector("time")?.getAttribute("dateTime"),
    "2026-09-27T12:00:00.000Z",
  );
  assert.match(document.body.textContent!, /may omit parts of the full thread/);
});

test("missing metadata never borrows article-summary coverage or invents a timestamp", () => {
  const document = render(fixture("sparse_support"), { coverage: null, analyzedAt: "invalid" });
  assert.match(document.body.textContent!, /Analyzed-comment count unavailable/);
  assert.match(document.body.textContent!, /Analysis time unavailable/);
  assert.equal(document.querySelector("time"), null);
});

test("neutral questions and ethical concern retain their themes", () => {
  for (const id of ["neutral_question", "ethical_concern"]) {
    const document = render(fixture(id));
    assert.ok(document.querySelectorAll(".analysis-theme").length > 0);
    assert.doesNotMatch(document.body.textContent!, /supportive/i);
  }
});

test("source text is rendered as text, never executable markup", () => {
  const analysis = JSON.parse(JSON.stringify(fixture("one_sided_criticism"))) as Analysis;
  analysis.topics[0].title = '<img src=x onerror="alert(1)">';
  analysis.topics[0].summary = "<script>alert(1)</script>";
  const document = render(analysis);
  assert.equal(document.querySelector("img, script"), null);
  assert.ok(document.body.textContent?.includes("<script>"));
});

test("theme sources use an independent popup with a named trigger and close button", () => {
  const analysis = fixture("one_sided_criticism");
  const document = render(analysis);
  for (const [index, theme] of [...document.querySelectorAll(".analysis-theme")].entries()) {
    const description = theme.querySelector(".analysis-theme-details")!;
    const trigger = theme.querySelector(".analysis-source-info")!;
    const panel = theme.querySelector(".analysis-source-popup")!;
    const close = panel.querySelector("button")!;
    assert.equal(description.hasAttribute("open"), false);
    assert.equal(description.querySelector("a, button"), null);
    assert.equal(
      trigger.getAttribute("aria-label"),
      `Source comments for ${analysis.topics[index].title}`,
    );
    assert.equal(trigger.getAttribute("popovertarget"), panel.id);
    assert.equal(panel.getAttribute("popover"), "auto");
    assert.equal(panel.getAttribute("role"), "dialog");
    assert.equal(
      document.getElementById(panel.getAttribute("aria-labelledby")!)?.textContent,
      "Source comments",
    );
    assert.equal(close.getAttribute("aria-label"), "Close source comments");
    assert.equal(close.getAttribute("popovertarget"), panel.id);
    assert.equal(close.getAttribute("popovertargetaction"), "hide");
    assert.equal(close.querySelector("svg")?.getAttribute("aria-hidden"), "true");
    assert.equal(panel.querySelectorAll("a").length, analysis.topics[index].comment_ids.length);
  }
});

test("topics sharing a category key target their own source popup", () => {
  const original = fixture("one_sided_criticism");
  const analysis = {
    ...original,
    topics: [
      { ...original.topics[0], title: "Benchmark conditions", comment_ids: [101] },
      { ...original.topics[0], title: "Benchmark reproducibility", comment_ids: [102, 103] },
    ],
  };
  const document = render(analysis);
  const themes = [...document.querySelectorAll(".analysis-theme")];
  const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const [index, theme] of themes.entries()) {
    const trigger = theme.querySelector(".analysis-source-info")!;
    const panel = document.getElementById(trigger.getAttribute("popovertarget")!)!;
    assert.equal(panel, theme.querySelector(".analysis-source-popup"));
    assert.deepEqual(
      [...panel.querySelectorAll("a")].map((link) => link.getAttribute("href")),
      analysis.topics[index].comment_ids.map((id) => `https://news.ycombinator.com/item?id=${id}`),
    );
    const close = panel.querySelector(".analysis-source-close")!;
    assert.equal(document.getElementById(close.getAttribute("popovertarget")!), panel);
    const label = document.getElementById(panel.getAttribute("aria-labelledby")!)!;
    assert.ok(panel.contains(label), "each popup resolves its own accessible heading");
  }
});

test("analysis coverage is inside a named, initially closed info popup", () => {
  const document = render(fixture("one_sided_criticism"));
  const trigger = document.querySelector(".analysis-heading > button")!;
  const panel = document.getElementById(trigger.getAttribute("popovertarget")!)!;
  assert.equal(trigger.getAttribute("aria-label"), "About this discussion analysis");
  assert.equal(panel.getAttribute("popover"), "auto");
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(panel.hasAttribute("open"), false);
  assert.ok(panel.contains(document.querySelector(".analysis-coverage")));
  assert.equal(
    document.getElementById(panel.getAttribute("aria-labelledby")!)?.textContent,
    "Analysis details",
  );
  const close = panel.querySelector("button")!;
  assert.equal(close.getAttribute("popovertarget"), panel.id);
  assert.equal(close.getAttribute("popovertargetaction"), "hide");
  assert.equal(close.getAttribute("aria-label"), "Close analysis information");
  assert.doesNotMatch(document.body.textContent!, /Read the full HN discussion/);
});
