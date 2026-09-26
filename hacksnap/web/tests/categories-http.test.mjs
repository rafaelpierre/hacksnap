import assert from 'node:assert/strict';
import {test} from 'node:test';

const origin = process.env.HACKSNAP_TEST_URL;
const options = {skip: !origin};

test('homepage and story flairs lead to category pages without a category directory', options, async () => {
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /class="category-badge"/);
  assert.doesNotMatch(html, /Browse by topic|class="category-nav"/);
  const api = await (await fetch(`${origin}/api/stories`)).json();
  const story = api.stories.find(story => story.category);
  assert.ok(story, 'Preview must contain categorized stories');
  const slug = story.category.replaceAll('_', '-');
  const article = await fetch(`${origin}/story/${story.hn_id}`);
  assert.equal(article.status, 200);
  const articleHTML = await article.text();
  assert.match(articleHTML, new RegExp(`class="category-badge"[^>]*href="/category/${slug}"`));
  const category = await fetch(`${origin}/category/${slug}`);
  assert.equal(category.status, 200);
  const categoryHTML = await category.text();
  assert.match(categoryHTML, new RegExp(`href="/story/${story.hn_id}"`));
  assert.match(categoryHTML, new RegExp(`rel="canonical" href="https://hacksnap.live/category/${slug}"`));
  assert.doesNotMatch(categoryHTML, /Browse by topic|class="category-nav"/);
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  assert.match(sitemap, new RegExp(`/category/${slug}`));
});

test('unknown categories and invalid or empty pagination return 404', options, async () => {
  for (const path of ['/category/unknown', '/category/agents-coding?page=0',
    '/category/agents-coding?page=2&page=3', '/category/agents-coding?page=9999999']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});

test('story pages render category next reads and topic continuation without recommendations', options, async () => {
  const response = await fetch(`${origin}/story/90000001`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const section = html.match(/<section class="related-stories"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'Next reads must be in the initial HTML');
  assert.match(section, /id="related-stories-heading">Read next/);
  assert.match(section, /More in Agents &amp; Coding/);
  assert.match(section, /href="\/story\/90000004"/);
  assert.doesNotMatch(section, /href="\/story\/90000001"/);
  assert.match(section, /href="\/category\/agents-coding"/);
  assert.match(section, /class="related-topic"/);
  assert.doesNotMatch(section, /class="feed-excerpt"/);
  assert.doesNotMatch(section, /Added |<time dateTime=/);
  assert.ok(html.indexOf('class="related-stories"') > html.indexOf('id="discussion-heading"'));

  const pending = await (await fetch(`${origin}/story/90000009`)).text();
  const fallback = pending.match(/<section class="related-stories"[\s\S]*?<\/section>/)?.[0];
  assert.ok(fallback);
  assert.match(fallback, /id="related-stories-heading">Read next/);
  assert.match(fallback, /href="\/category\/safety-privacy"[^>]*>More in Safety &amp; Privacy/);
  assert.doesNotMatch(fallback, /related-story-list/);
});
