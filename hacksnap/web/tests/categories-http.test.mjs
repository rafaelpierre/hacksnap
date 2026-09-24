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
