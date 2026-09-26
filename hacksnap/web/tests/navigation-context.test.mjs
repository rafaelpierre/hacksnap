import assert from 'node:assert/strict';
import {test} from 'node:test';
import {browseLabel, validBrowseContext} from '../lib/navigation-context.ts';

test('browse context retains list selection and page', () => {
  assert.equal(browseLabel('/'), 'Top stories');
  assert.equal(browseLabel('/archive?page=3'), 'Latest stories · page 3');
  assert.equal(browseLabel('/archive/2026/09?page=2'), 'September 2026 archive · page 2');
  assert.equal(browseLabel('/category/agents-coding?page=4'), 'Agents & Coding · page 4');
});

test('return destination must be a recent internal browse route', () => {
  const now = Date.now();
  const context = {url: '/archive/2026/09?page=2', label: 'September 2026 archive · page 2', scrollY: 820, savedAt: now};
  assert.deepEqual(validBrowseContext(context, now), context);
  assert.equal(validBrowseContext({...context, savedAt: now - 9 * 60 * 60 * 1000}, now), null);
  assert.equal(validBrowseContext({...context, scrollY: -1}, now), null);
  assert.equal(validBrowseContext({...context, label: 'Top stories'}, now), null);
  for (const url of ['//evil.example', '/\\evil.example', 'https://evil.example', '/story/123', '/archive?next=https://evil.example', '/archive/2026/13', '/category/unknown']) {
    assert.equal(browseLabel(url), null, url);
    assert.equal(validBrowseContext({...context, url}, now), null, url);
  }
});
