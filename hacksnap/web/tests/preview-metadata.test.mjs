import assert from 'node:assert/strict';
import {test} from 'node:test';
import {previewText, storyPreviewMetadata} from '../lib/preview-metadata.ts';

test('long stories get compact previews without changing the source title or image alt', () => {
  const title = 'Kev: Tiny Jev-like family of decision models built on top of Qwen3.5';
  const story = {hn_id:'49783999', title, summary:{overall_takeaway:'A small family of decision models explores practical tradeoffs in speed, model size, training data and accuracy. '.repeat(3)}};
  const metadata = storyPreviewMetadata(story);
  assert.ok(Array.from(metadata.title.absolute).length <= 60);
  assert.ok(Array.from(metadata.openGraph.title).length <= 60);
  assert.ok(Array.from(metadata.description).length <= 155);
  assert.ok(Array.from(metadata.openGraph.description).length <= 125);
  assert.equal(metadata.twitter.description, metadata.openGraph.description);
  assert.equal(metadata.openGraph.siteName, 'Hacksnap');
  assert.equal(metadata.twitter.card, 'summary_large_image');
  assert.equal(metadata.twitter.images[0].alt, title);
  assert.equal(story.title, title);
  assert.equal(metadata.alternates.canonical, 'https://hacksnap.live/story/49783999');
});

test('short stories retain their title and brand; pending or blank summaries have a fallback', () => {
  for (const summary of [null, {overall_takeaway:'   '}]) {
    const metadata = storyPreviewMetadata({hn_id:'1', title:'Small models', summary});
    assert.equal(metadata.title.absolute, 'Small models | Hacksnap');
    assert.equal(metadata.openGraph.title, 'Small models');
    assert.equal(metadata.description, 'Read Small models and its Hacker News discussion on Hacksnap.');
  }
});

test('preview clipping normalizes whitespace, respects words and preserves Unicode code points', () => {
  assert.equal(previewText('  One\n two  ', 10), 'One two');
  assert.equal(previewText('Alpha beta gamma', 11), 'Alpha beta…');
  assert.equal(previewText('Alpha beta gamma', 9), 'Alpha…');
  assert.equal(previewText('😀'.repeat(20), 5), '😀😀😀😀…');
  assert.equal(previewText('A'.repeat(20), 5), 'AAAA…');
});
