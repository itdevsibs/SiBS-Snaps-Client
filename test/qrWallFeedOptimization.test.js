import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePhotosResponse,
  appendFeedPhotos,
  prependFeedPhotos,
  resolveImageVariants,
  isAnimatedGif,
} from '../src/pages/qr-wall/qrWallFeedState.js';
import { applyReactionChange } from '../src/pages/qr-wall/qrWallDisplayState.js';

// 1. Initial 10 posts
test('1. initial 10 posts: parses 10 initial posts and pagination cursor', () => {
  const initialPayload = {
    event: { id: 1, title: 'SiBS 15th Anniversary' },
    photos: Array.from({ length: 10 }, (_, i) => ({
      id: 100 - i,
      uploadedBy: `Employee ${i + 1}`,
      reactionCount: i,
      images: {
        thumbnail: `/thumb/${100 - i}.jpg`,
        feed: `/feed/${100 - i}.webp`,
        large: `/large/${100 - i}.webp`,
        width: 1080,
        height: 1080,
      },
    })),
    pagination: {
      nextCursor: 'cursor_after_10',
      hasMore: true,
    },
  };

  const parsed = parsePhotosResponse(initialPayload);
  assert.equal(parsed.photos.length, 10);
  assert.equal(parsed.photos[0].id, 100);
  assert.equal(parsed.photos[9].id, 91);
  assert.equal(parsed.nextCursor, 'cursor_after_10');
  assert.equal(parsed.hasMore, true);
  assert.equal(parsed.event?.title, 'SiBS 15th Anniversary');
});

// 2. Next pages
test('2. next pages: loads subsequent page using nextCursor and stops when hasMore=false', () => {
  const page2Payload = {
    photos: Array.from({ length: 10 }, (_, i) => ({
      id: 90 - i,
      uploadedBy: `Employee ${i + 11}`,
    })),
    pagination: {
      nextCursor: 'cursor_after_20',
      hasMore: true,
    },
  };

  const parsedPage2 = parsePhotosResponse(page2Payload);
  assert.equal(parsedPage2.photos.length, 10);
  assert.equal(parsedPage2.nextCursor, 'cursor_after_20');
  assert.equal(parsedPage2.hasMore, true);

  const finalPagePayload = {
    photos: [{ id: 80, uploadedBy: 'First poster ever' }],
    pagination: {
      nextCursor: null,
      hasMore: false,
    },
  };

  const parsedFinal = parsePhotosResponse(finalPagePayload);
  assert.equal(parsedFinal.photos.length, 1);
  assert.equal(parsedFinal.nextCursor, null);
  assert.equal(parsedFinal.hasMore, false);
});

// 3. No duplicate rows
test('3. no duplicate rows: deduplicates posts by ID when appending or prepending', () => {
  const existing = [{ id: 10 }, { id: 9 }, { id: 8 }];
  // Overlapping page response (e.g. race condition or concurrent page fetch)
  const incoming = [{ id: 9 }, { id: 8 }, { id: 7 }, { id: 6 }];

  const merged = appendFeedPhotos(existing, incoming);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged.map(p => p.id), [10, 9, 8, 7, 6]);

  // Repeated append produces identical array without extra rows
  const repeated = appendFeedPhotos(merged, [{ id: 10 }, { id: 7 }]);
  assert.equal(repeated.length, 5);
});

// 4. Image fallback
test('4. image fallback: supports legacy posts without image variants or invalid dimensions', () => {
  const legacyPost = {
    id: 55,
    uploadedBy: 'Legacy Guest',
    caption: 'Classic photo',
  };

  const fallbackUrl = 'http://localhost:5001/api/qr-wall/public/tok/photos/55/image';
  const variants = resolveImageVariants(legacyPost, fallbackUrl);

  assert.equal(variants.feedSrc, fallbackUrl);
  assert.equal(variants.largeSrc, fallbackUrl);
  assert.equal(variants.thumbSrc, '');
  assert.equal(variants.aspectRatio, undefined);
  assert.equal(variants.srcSet, undefined);
});

// 5. GIF animation
test('5. GIF animation: ensures animated GIFs continue playing without static srcSets', () => {
  const gifPost = {
    id: 60,
    uploadedBy: 'Celebrator',
    mimeType: 'image/gif',
    images: {
      feed: '/uploads/dance.gif',
      large: '/uploads/dance.gif',
      thumbnail: '/uploads/dance_thumb.jpg',
      width: 480,
      height: 480,
    },
  };

  assert.equal(isAnimatedGif(gifPost), true);

  const variants = resolveImageVariants(gifPost);
  assert.equal(variants.isGif, true);
  assert.equal(variants.feedSrc, '/uploads/dance.gif');
  // Omit static srcSet so browser does not replace GIF with static thumbnail
  assert.equal(variants.srcSet, undefined);
  assert.equal(variants.aspectRatio, '480 / 480');
});

// 6. New uploads
test('6. new uploads: prepends newly published posts without full feed reload', () => {
  const currentFeed = [
    { id: 100, uploadedBy: 'Alice', reactionCount: 3 },
    { id: 99, uploadedBy: 'Bob', reactionCount: 1 },
  ];

  const newlyUploaded = [
    { id: 101, uploadedBy: 'Charlie', reactionCount: 0 },
  ];

  const updatedFeed = prependFeedPhotos(currentFeed, newlyUploaded);
  assert.equal(updatedFeed.length, 3);
  assert.equal(updatedFeed[0].id, 101);
  assert.equal(updatedFeed[1].id, 100);
  assert.equal(updatedFeed[2].id, 99);
});

// 7. Celebrate
test('7. Celebrate: updates Celebrate reaction counts individually by photo ID', () => {
  const feed = [
    { id: 101, reactionCount: 0, reacted: false },
    { id: 100, reactionCount: 3, reacted: true },
  ];

  const reactionChange = {
    type: 'reaction-added',
    photoId: '101',
    reactionCount: 1,
  };

  const updated = applyReactionChange(feed, reactionChange);
  assert.equal(updated[0].id, 101);
  assert.equal(updated[0].reactionCount, 1);
  // Post 100 remains completely unchanged
  assert.equal(updated[1].id, 100);
  assert.equal(updated[1].reactionCount, 3);
});

// 8. Scroll position
test('8. scroll position: preserves older feed state and queues new items when scrolled down', () => {
  const feed = [{ id: 100 }, { id: 99 }];
  const incomingNew = [{ id: 102 }, { id: 101 }];

  // When user is scrolled down, new posts are held in queue
  const isScrolledDown = true;
  let queue = [];
  if (isScrolledDown) {
    const knownIds = new Set(feed.map(p => String(p.id)));
    const itemsForQueue = incomingNew.filter(p => !knownIds.has(String(p.id)));
    queue = [...itemsForQueue, ...queue];
  }

  assert.equal(queue.length, 2);
  assert.equal(queue[0].id, 102);
  assert.equal(queue[1].id, 101);
  // Feed itself was not disrupted
  assert.equal(feed.length, 2);

  // When user clicks indicator to scroll to top:
  const mergedFeed = prependFeedPhotos(feed, queue);
  assert.equal(mergedFeed.length, 4);
  assert.deepEqual(mergedFeed.map(p => p.id), [102, 101, 100, 99]);
});

// 9. Refresh
test('9. refresh: lightweight first-page sync retains previously loaded pages', () => {
  // User had scrolled through page 1 and page 2 (total 20 photos)
  const fullLoadedFeed = Array.from({ length: 20 }, (_, i) => ({
    id: 100 - i,
    uploadedBy: `User ${i}`,
    reactionCount: 1,
  }));

  // Background refresh only fetches first page (latest 10 photos)
  const firstPageRefresh = Array.from({ length: 10 }, (_, i) => ({
    id: 100 - i,
    uploadedBy: `User ${i}`,
    reactionCount: i === 0 ? 5 : 1, // Reaction count on newest photo increased
  }));

  const result = prependFeedPhotos(fullLoadedFeed, firstPageRefresh);
  // Total count is STILL 20; older photos (ids 90..81) were not discarded!
  assert.equal(result.length, 20);
  assert.equal(result[0].reactionCount, 5); // Updated reaction count
  assert.equal(result[19].id, 81); // Oldest loaded photo remains present
});

// 10. Empty state
test('10. empty state: handles zero photos gracefully', () => {
  const emptyEnvelope = {
    event: { id: 2, title: 'Fresh Event' },
    photos: [],
    pagination: {
      nextCursor: null,
      hasMore: false,
    },
  };

  const parsed = parsePhotosResponse(emptyEnvelope);
  assert.equal(parsed.photos.length, 0);
  assert.equal(parsed.hasMore, false);
  assert.equal(parsed.nextCursor, null);
  assert.equal(parsed.event?.title, 'Fresh Event');
});

// 11. API failure
test('11. API failure: safely handles null, undefined, or error responses without throwing', () => {
  assert.doesNotThrow(() => {
    const parsedNull = parsePhotosResponse(null);
    assert.deepEqual(parsedNull.photos, []);
    assert.equal(parsedNull.hasMore, false);

    const parsedEmpty = parsePhotosResponse({});
    assert.deepEqual(parsedEmpty.photos, []);
    assert.equal(parsedEmpty.hasMore, false);

    const appended = appendFeedPhotos([{ id: 1 }], null);
    assert.equal(appended.length, 1);
  });
});

// 12. Desktop & Mobile responsive
test('12. desktop & mobile: generates valid srcSet and sizes for responsive viewports', () => {
  const photo = {
    id: 77,
    images: {
      feed: 'https://cdn.example.com/photos/feed_720.webp',
      large: 'https://cdn.example.com/photos/large_1440.webp',
      width: 1440,
      height: 960,
    },
  };

  const variants = resolveImageVariants(photo);
  assert.ok(variants.srcSet.includes('https://cdn.example.com/photos/feed_720.webp 720w'));
  assert.ok(variants.srcSet.includes('https://cdn.example.com/photos/large_1440.webp 1440w'));
  assert.equal(variants.sizes, '(max-width: 640px) 100vw, 520px');
  assert.equal(variants.aspectRatio, '1440 / 960');
});

