import assert from "node:assert/strict";
import { expect, test } from "@jest/globals";
import { readyStoriesHandler } from "../lib/stories-api.ts";
import { ReadyStoryPageError } from "../lib/ready-story-pagination-errors.ts";
import { latestRankChange } from "../lib/rank-history.ts";

const story = {
  hn_id: "123",
  title: "Example",
  url: "https://example.com",
  image_url: "https://store.public.blob.vercel-storage.com/articles/123.webp",
  image_status: "ready",
  image_width: 1200,
  image_height: 675,
  image_mime_type: "image/webp",
  image_source_url: "https://publisher.example/private-provenance.jpg",
  points: 2,
  category: "agents_coding",
  category_model: "private-classifier",
  comment_count: 1,
  date_added: new Date("2026-09-19T12:00:00Z"),
  summary: {
    article_summary: null,
    discussion_summary: "Discussion",
    overall_takeaway: "Takeaway",
    model: "private-extra",
  },
  internal_diagnostics: "must never be exposed",
};

test("ready-story pagination exposes card fields and explicit continuation failures", async () => {
  const inputs = [];
  const api = readyStoriesHandler({
    getReadyStoryPage: async (input) => {
      inputs.push(input);
      if (input.cursor === "expired") throw new ReadyStoryPageError("snapshot_expired");
      if (!Number.isFinite(input.pageSize ?? 10))
        throw new ReadyStoryPageError("invalid_page_size");
      return {
        stories: [
          {
            ...story,
            rank: "12",
            is_recent: false,
            rank_history: [
              { observed_at: "2026-09-29T08:00:00.000Z", rank: 18 },
              { observed_at: "not a timestamp", rank: 17 },
              { observed_at: "2026-09-29T09:00:00.000Z", rank: 16 },
              { observed_at: "2026-09-29T10:00:00.000Z", rank: 14 },
              { observed_at: "2026-09-29T11:00:00.000Z", rank: 13 },
            ],
          },
        ],
        ingestion: null,
        observed_at: "2026-09-29T12:00:00.000Z",
        selectionIds: ["123", "124"],
        pagination: {
          cursor: "next",
          previousCursor: null,
          hasMore: true,
          page: 1,
          expiresAt: "2026-09-29T20:00:00.000Z",
          selectionLimited: false,
        },
      };
    },
  });
  const response = await api(new Request("https://hacksnap.live/api/ready-stories?pageSize=10"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.stories[0].rank, "12");
  assert.equal(body.stories[0].is_recent, false);
  assert.equal(body.stories[0].story_slug, null);
  assert.equal(body.stories[0].summary.overall_takeaway, "Takeaway");
  expect(body.stories[0].rank_history).toEqual([
    { observed_at: "2026-09-29T10:00:00.000Z", rank: 14 },
    { observed_at: "2026-09-29T11:00:00.000Z", rank: 13 },
  ]);
  assert.equal(
    latestRankChange(body.stories[0].rank_history, body.stories[0].rank),
    1,
    "the compact history preserves the ranked-card movement badge",
  );
  assert.equal(body.pagination.cursor, "next");
  expect(body.selectionIds).toEqual(["123", "124"]);
  assert.deepEqual(inputs, [{ cursor: undefined, pageSize: 10 }]);

  const fresh = await api(new Request("https://hacksnap.live/api/ready-stories?fresh=1"));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get("cache-control"), "no-store");
  expect((await fresh.json()).selectionIds).toEqual(["123", "124"]);
  assert.deepEqual(inputs.at(-1), { cursor: undefined, pageSize: undefined, fresh: true });

  const expired = await api(new Request("https://hacksnap.live/api/ready-stories?cursor=expired"));
  assert.equal(expired.status, 410);
  expect(await expired.json()).toEqual({
    error: "Story selection has expired. Start again.",
    code: "snapshot_expired",
  });
  const invalid = await api(
    new Request("https://hacksnap.live/api/ready-stories?cursor=one&cursor=two"),
  );
  assert.equal(invalid.status, 400);
  for (const query of ["fresh=1&cursor=one", "fresh=1&fresh=1", "fresh=0", "fresh=true"]) {
    const rejected = await api(new Request(`https://hacksnap.live/api/ready-stories?${query}`));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.headers.get("cache-control"), "no-store");
  }
  assert.equal(inputs.length, 3, "invalid query inputs do not call data access");
});
