import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRenderedPhoto } from '../src/pages/qr-wall/qrWallDisplayState.js';
import * as displayState from '../src/pages/qr-wall/qrWallDisplayState.js';

test('keeps the decoded visible slide rendered when moderation removes it from the refreshed feed', () => {
  const retained = { id: 12, uploadedBy: 'Guest', caption: 'Anniversary' };
  const refreshedPhotos = [{ id: 11, uploadedBy: 'Another guest' }];

  assert.equal(resolveRenderedPhoto(refreshedPhotos, '12', retained), retained);
});

test('uses refreshed metadata while the visible slide still exists', () => {
  const retained = { id: 12, reactionCount: 1 };
  const refreshed = { id: 12, reactionCount: 2 };

  assert.equal(resolveRenderedPhoto([refreshed], '12', retained), refreshed);
});

test('does not reuse a retained slide for a different visible id', () => {
  const retained = { id: 12 };

  assert.equal(resolveRenderedPhoto([], '13', retained), null);
});

test('caps the display animation at ten hearts when reactions exceed ten', () => {
  assert.equal(displayState.getAnimatedHeartCount?.(27, 'display'), 10);
});

test('renders one display heart per reaction below the cap', () => {
  assert.equal(displayState.getAnimatedHeartCount?.(6, 'display'), 6);
});

test('keeps the existing feed animation limit separate from the display cap', () => {
  assert.equal(displayState.getAnimatedHeartCount?.(27, 'feed'), 27);
});

test('centers the display heart stream within the image width', () => {
  assert.equal(displayState.getDisplayHeartX?.(0), 42);
  assert.equal(displayState.getDisplayHeartX?.(0.5), 50);
  assert.equal(displayState.getDisplayHeartX?.(1), 58);
});

test('does not trigger a reaction pop when a photo is first displayed', () => {
  assert.equal(displayState.hasReactionIncrease?.(undefined, 8), false);
});

test('triggers a reaction pop when the count increased since the last display', () => {
  assert.equal(displayState.hasReactionIncrease?.(8, 11), true);
});

test('does not trigger a reaction pop for unchanged or reduced totals', () => {
  assert.equal(displayState.hasReactionIncrease?.(8, 8), false);
  assert.equal(displayState.hasReactionIncrease?.(8, 7), false);
});

test('applies a live reaction event to the matching displayed photo', () => {
  const photos = [{ id: 41, reactionCount: 2 }, { id: 42, reactionCount: 8 }];
  assert.deepEqual(displayState.applyReactionChange?.(photos, {
    type: 'reaction-added', photoId: '42', reactionCount: 9,
  }), [{ id: 41, reactionCount: 2 }, { id: 42, reactionCount: 9 }]);
});

test('ignores unrelated or malformed live events', () => {
  const photos = [{ id: 42, reactionCount: 8 }];
  assert.equal(displayState.applyReactionChange?.(photos, { type: 'comment-added' }), photos);
  assert.equal(displayState.applyReactionChange?.(photos, { type: 'reaction-added' }), photos);
});

test('display prefers the smaller feed variant and retains large as fallback', () => {
  assert.deepEqual(displayState.getDisplayImageCandidates?.({
    images: { feed: '/photo-feed.webp', large: '/photo-large.webp' },
  }, '/legacy.jpg'), ['/photo-feed.webp', '/photo-large.webp', '/legacy.jpg']);
});

test('display falls back when an optimized variant is unavailable', async () => {
  const requested = [];
  const blob = new Blob(['optimized-image'], { type: 'image/webp' });
  const result = await displayState.fetchDisplayImageBlob?.(
    ['/missing-feed.webp', '/photo-large.webp'],
    {
      timeoutMs: 100,
      fetchImpl: async url => {
        requested.push(url);
        return url.includes('missing')
          ? { ok: false, status: 503, headers: { get: () => 'application/json' } }
          : { ok: true, status: 200, headers: { get: () => 'image/webp' }, blob: async () => blob };
      },
    },
  );

  assert.deepEqual(requested, ['/missing-feed.webp', '/photo-large.webp']);
  assert.equal(result.blob, blob);
  assert.equal(result.url, '/photo-large.webp');
});

test('display image loading has a bounded timeout instead of stalling autoplay forever', async () => {
  const started = Date.now();
  await assert.rejects(displayState.fetchDisplayImageBlob?.(['/hung.webp'], {
    timeoutMs: 20,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  }), /timed out/i);
  assert.ok(Date.now() - started < 250, 'timeout must be bounded');
});

test('plays the feed Celebrate pop only for a newly added reaction', () => {
  assert.equal(displayState.shouldPlayCelebratePop?.({ reacted: true, alreadyReacted: false }), true);
  assert.equal(displayState.shouldPlayCelebratePop?.({ reacted: true, alreadyReacted: true }), false);
  assert.equal(displayState.shouldPlayCelebratePop?.({ reacted: false }), false);
  assert.equal(displayState.shouldPlayCelebratePop?.(undefined), false);
});
