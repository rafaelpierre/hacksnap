import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalStoryUrl, copyText, shareDestinations, suggestedPost, xPostStatus} from '../lib/share-text.ts';

test('copy link uses the canonical address and reports success only after writeText resolves', async () => {
  const url = canonicalStoryUrl('123');
  assert.equal(url, 'https://hacksnap.live/story/123');
  let resolveWrite;
  const clipboard = {writeText: value => {
    assert.equal(value, url);
    return new Promise(resolve => { resolveWrite = resolve; });
  }};
  const attempt = copyText(url, clipboard);
  let settled = false;
  void attempt.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveWrite();
  assert.equal(await attempt, true);
});

test('denied and unavailable clipboard writes return failure', async () => {
  assert.equal(await copyText('post', {writeText: async () => { throw new Error('denied'); }}), false);
  assert.equal(await copyText('post'), false);
});

test('a missing takeaway produces a complete draft with the title and canonical link', () => {
  const draft = suggestedPost('456', 'A full story title', null);
  assert.match(draft, /^A full story title\n\nSummary pending\./);
  assert.match(draft, /https:\/\/hacksnap\.live\/story\/456$/);
  assert.doesNotMatch(draft, /undefined|null/);
});

test('text destinations preserve edits while LinkedIn keeps the previewable canonical URL', () => {
  const edited = 'My own take — unchanged.\n\nhttps://hacksnap.live/story/789';
  const url = canonicalStoryUrl('789');
  const destinations = shareDestinations(edited, url, 'Original headline');
  const x = new URL(destinations.find(item => item.name === 'X').href);
  const linkedin = new URL(destinations.find(item => item.name === 'LinkedIn').href);
  const email = destinations.find(item => item.name === 'Email').href;
  assert.equal(x.searchParams.get('text'), edited);
  assert.equal(linkedin.searchParams.get('url'), url);
  assert.equal(destinations.find(item => item.name === 'LinkedIn').acceptsText, false);
  assert.ok(email.includes(encodeURIComponent(edited.replaceAll('\n', '\r\n'))));
});

test('copying a revised post writes the exact reader-authored text', async () => {
  const edited = 'Reader\'s revision — with punctuation!\n\nAnother line.';
  let written;
  assert.equal(await copyText(edited, {writeText: async text => { written = text; }}), true);
  assert.equal(written, edited);
});

test('X validation accounts for transformed links and weighted Unicode without changing the draft', () => {
  const url = canonicalStoryUrl('123');
  const fitting = `${'a'.repeat(256)} ${url}`;
  assert.deepEqual(xPostStatus(fitting), {length: 280, limit: 280, valid: true});
  assert.deepEqual(xPostStatus(`${'a'.repeat(257)} ${url}`), {length: 281, limit: 280, valid: false});
  assert.equal(xPostStatus('😀').length, 2);
  const longDraft = suggestedPost('123', 'Headline', 'takeaway '.repeat(400));
  assert.equal(xPostStatus(longDraft).valid, false);
  assert.ok(longDraft.includes('takeaway '.repeat(400).trim()));
});
