import assert from 'node:assert/strict';
import {test} from 'node:test';

// Run against the production build and tests/preview-db.mjs. These checks read
// server HTML, so they catch content lost before hydration or on direct arrival.
const origin = process.env.HACKSNAP_TEST_URL;
const options = {skip: !origin};

async function html(path) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/, path);
  return response.text();
}

test('Top, Latest, and Topics expose a server-rendered route into a story', options, async () => {
  for (const path of ['/', '/archive', '/topics', '/category/agents-coding']) {
    const page = await html(path);
    assert.match(page, /<main id="main">/, path);
    assert.match(page, /Skip to content/, path);
    assert.match(page, /aria-label="Main navigation"/, path);
    assert.match(page, /Top stories/, path);
    assert.match(page, /Latest/, path);
    assert.match(page, /Topics/, path);
    assert.match(page, /<h1[ >]/, path);
  }
  for (const path of ['/', '/archive', '/category/agents-coding']) {
    assert.match(await html(path), /href="\/story\/9000000[1-9]"/, path);
  }
  assert.match(await html('/topics'), /href="\/category\/agents-coding"/);
});

test('story content, attribution, next reads, and social metadata exist before hydration', options, async () => {
  const page = await html('/story/90000001');
  assert.match(page, /<h1>\[Demo\] The hidden cost/);
  assert.match(page, /id="article-heading">TLDR;/);
  assert.match(page, /id="discussion-heading">Discussion/);
  assert.match(page, /id="related-stories-heading">Read next/);
  assert.match(page, /Original article on example\.com/);
  assert.match(page, /href="https:\/\/news\.ycombinator\.com\/item\?id=90000101"/);
  assert.match(page, /rel="canonical" href="https:\/\/hacksnap\.live\/story\/90000001"/);
  assert.match(page, /property="og:image"/);
  assert.match(page, /name="twitter:card" content="summary_large_image"/);
  assert.ok(page.indexOf('id="article-heading"') < page.indexOf('id="discussion-heading"'));
  assert.ok(page.indexOf('id="discussion-heading"') < page.indexOf('id="related-stories-heading"'));
});

test('pending, unavailable, and discussion-only stories give an honest next action', options, async () => {
  const pending = await html('/story/90000009');
  assert.match(pending, /Summary pending/);
  assert.match(pending, /Read the <a href="https:\/\/example\.com/);
  assert.match(pending, /HN discussion/);
  assert.match(pending, /name="robots" content="noindex, follow"/);

  const unavailable = await html('/story/90000008');
  assert.match(unavailable, /original article was unavailable to summarize/);
  assert.match(unavailable, /Open the original source/);
  assert.match(unavailable, /No usable discussion was available/);
  assert.match(unavailable, /Read the HN thread/);

  const discussionOnly = await html('/story/90000010');
  assert.match(discussionOnly, /Hacker News ↗/);
  assert.match(discussionOnly, /This is an HN post/);
  assert.doesNotMatch(discussionOnly, /Original article on example\.com/);
});

test('long headlines, route recovery, and canonical archive/category pages survive direct requests', options, async () => {
  const longStory = await html('/story/90000007');
  assert.match(longStory, /very long headline keeps explaining the same caveat/);
  assert.match(await html('/archive'), /rel="canonical" href="https:\/\/hacksnap\.live\/archive"/);
  assert.match(await html('/category/agents-coding'), /rel="canonical" href="https:\/\/hacksnap\.live\/category\/agents-coding"/);
  const missing = await fetch(`${origin}/story/99999999`);
  // Next can stream the not-found boundary after committing a 200 response.
  const missingPage = await missing.text();
  assert.match(missingPage, /Story not found/);
  assert.match(missingPage, /Back to stories/);
});
