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
      hnURL: "https://news.ycombinator.com/item?id=100",
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
    for (const topic of analysis.topics) {
      const detail = [...document.querySelectorAll("details")].find(
        (item) => item.querySelector("summary")?.textContent === topic.title,
      );
      assert.ok(detail, "every theme has a native keyboard disclosure");
      assert.ok(detail.textContent?.includes(topic.summary));
      for (const id of topic.comment_ids) {
        const link = detail
          .closest(".analysis-theme")!
          .querySelector(`a[href="https://news.ycombinator.com/item?id=${id}"]`);
        assert.ok(link?.getAttribute("aria-label")?.includes(topic.title));
      }
    }
    for (const highlight of [...analysis.critical_comments, ...analysis.supportive_comments]) {
      const link = document.querySelector(
        `.analysis-highlights a[href="https://news.ycombinator.com/item?id=${highlight.comment_id}"]`,
      );
      assert.ok(link?.getAttribute("aria-label")?.includes(highlight.paraphrase));
      assert.ok(link);
      const item = link.closest(".analysis-highlights > li")!;
      assert.ok(item.textContent?.includes(highlight.explanation));
      assert.ok(
        item.textContent?.includes(
          analysis.reference_claims.find((claim) => claim.id === highlight.claim_id)!.text,
        ),
      );
      assert.ok(item.querySelector(".analysis-stance")?.textContent);
    }
    if (analysis.status === "available") {
      assert.equal(document.querySelectorAll(".analysis-group").length, 2);
      for (const kind of ["critical", "supportive"] as const) {
        if (!analysis[`${kind}_comments`].length)
          assert.ok(
            text.includes(
              `No clear ${kind} examples in the analyzed comments. Other views may exist elsewhere in the thread.`,
            ),
          );
      }
    } else {
      assert.equal(document.querySelectorAll(".analysis-group").length, 0);
      assert.ok(
        text.includes(
          analysis.status === "no_comments"
            ? "No usable comments were available"
            : "did not contain a clear claim",
        ),
      );
    }
  });
}

test("both groups preserve qualifications and identify the source of each claim", () => {
  const analysis = {
    ...fixture("one_sided_criticism"),
    supportive_comments: fixture("qualified_agreement").supportive_comments,
  };
  const document = render(analysis);
  assert.match(document.body.textContent!, /Most critical/);
  assert.match(document.body.textContent!, /Most supportive/);
  assert.match(document.body.textContent!, /Agrees with reservations/);
  assert.match(document.body.textContent!, /Claim addressed \(article\)/);
  assert.equal(document.querySelectorAll(".analysis-highlights > li").length, 2);
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

test("neutral questions and ethical concern provide themes without supportive evidence", () => {
  for (const id of ["neutral_question", "ethical_concern"]) {
    const document = render(fixture(id));
    assert.equal(document.querySelectorAll(".analysis-highlights > li").length, 0);
    assert.match(document.body.textContent!, /No clear supportive examples/);
  }
});

test("source text is rendered as text, never executable markup", () => {
  const analysis = JSON.parse(JSON.stringify(fixture("one_sided_criticism"))) as Analysis;
  analysis.topics[0].title = '<img src=x onerror="alert(1)">';
  analysis.critical_comments[0].paraphrase = "<script>alert(1)</script>";
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

test("both highlight groups put italic claims before the stance and keep links in popups", () => {
  const analysis = {
    ...fixture("one_sided_criticism"),
    supportive_comments: fixture("qualified_agreement").supportive_comments,
  };
  const document = render(analysis);
  const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, "every popup has a distinct target");
  for (const item of document.querySelectorAll(".analysis-highlights > li")) {
    const header = item.firstElementChild!;
    assert.ok(header.matches(".analysis-highlight-header"));
    assert.ok(header.querySelector(".analysis-claim em")?.textContent);
    assert.ok(header.nextElementSibling?.matches(".analysis-stance"));
    assert.ok(header.nextElementSibling?.nextElementSibling?.matches(".analysis-paraphrase"));
    const panel = header.querySelector("[popover]")!;
    const trigger = header.querySelector(".analysis-source-info")!;
    assert.equal(trigger.getAttribute("popovertarget"), panel.id);
    assert.equal(panel.getAttribute("popover"), "auto");
    assert.equal(panel.querySelectorAll("a").length, 1);
    assert.equal(item.querySelectorAll("a").length, 1);
    assert.equal(panel.querySelector(".analysis-claim"), null);
    assert.equal(
      panel.querySelector(".analysis-source-close")?.getAttribute("popovertargetaction"),
      "hide",
    );
  }
});
