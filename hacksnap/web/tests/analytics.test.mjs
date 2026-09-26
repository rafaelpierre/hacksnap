import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {copyShareText, recordVisit, track, trackOnce} from '../lib/analytics.ts';

function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

test('story events deduplicate within a tracking session and remain nonblocking without GA', () => {
  const calls = [];
  globalThis.window = {gtag: (...args) => calls.push(args)};
  globalThis.sessionStorage = storage();
  trackOnce('story:1', {name: 'story_view', story_id: '1'});
  trackOnce('story:1', {name: 'story_view', story_id: '1'});
  trackOnce('story:2', {name: 'story_view', story_id: '2'});
  assert.deepEqual(calls.map(call => call[2].story_id), ['1', '2']);
  delete window.gtag;
  assert.doesNotThrow(() => track({name: 'story_view', story_id: '3'}));
  assert.deepEqual(window.hacksnapPendingEvents[0], ['story_view', {story_id: '3'}]);
});

test('return event requires a previous visit 1 to 30 days earlier and fires once', () => {
  const calls = [];
  globalThis.window = {gtag: (...args) => calls.push(args)};
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  const day = 86_400_000;
  const start = Date.now() - 3 * day;
  recordVisit(start);
  recordVisit(start + 2 * day);
  recordVisit(start + 2 * day);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'return_visit');
  assert.equal(calls[0][2].days_since_previous_visit, 2);
});

test('blocked storage and analytics do not interrupt site actions', () => {
  globalThis.window = {gtag: () => {throw Error('blocked')}};
  globalThis.localStorage = {getItem: () => {throw Error('blocked')}};
  globalThis.sessionStorage = {getItem: () => {throw Error('blocked')}};
  assert.doesNotThrow(() => recordVisit());
  assert.doesNotThrow(() => trackOnce('story:1', {name: 'story_view', story_id: '1'}));
});

test('copy reports success only after a resolved clipboard write and failure offers fallback', async () => {
  const calls = [];
  globalThis.window = {gtag: (...args) => calls.push(args)};
  const success = await copyShareText('editable suggestion', '42', 'story_end', 'post', async value => {
    assert.equal(value, 'editable suggestion');
  });
  const failure = await copyShareText('editable suggestion', '42', 'story_end', 'post', async () => {
    throw Error('permission denied');
  });
  assert.equal(success, true);
  assert.equal(failure, false);
  assert.deepEqual(calls.map(call => call[1]), [
    'share_copy_success', 'share_copy_failure', 'share_manual_fallback',
  ]);
  assert.ok(calls.every(call => !Object.values(call[2]).includes('editable suggestion')));
  await copyShareText('https://hacksnap.live/story/42', '42', 'feed', 'link', async () => {});
  assert.equal(calls.at(-1)[2].copy_kind, 'link');
});
