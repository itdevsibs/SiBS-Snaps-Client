import test from 'node:test';
import assert from 'node:assert/strict';

const queue = await import('../src/pages/qr-wall/qrWallUploadQueue.js').catch(() => ({}));
const processor = await import('../src/pages/qr-wall/qrWallUploadQueueProcessor.js').catch(() => ({}));

const first = {
  requestId: '11111111-1111-4111-8111-111111111111',
  eventToken: 'a'.repeat(48),
  status: 'queued',
  createdAt: 100,
};

test('reload normalizes interrupted work for reconciliation without re-uploading it', () => {
  assert.equal(typeof queue.normalizeUploadQueueItem, 'function');
  assert.equal(queue.normalizeUploadQueueItem({ ...first, status: 'optimizing' }).status, 'queued');
  assert.equal(queue.normalizeUploadQueueItem({ ...first, status: 'uploading' }).status, 'needs-check');
  assert.equal(queue.normalizeUploadQueueItem({ ...first, status: 'confirming' }).status, 'needs-check');
  assert.equal(queue.normalizeUploadQueueItem({ ...first, status: 'failed' }).status, 'failed');
});

test('selects one oldest processable item for the current event only', () => {
  const otherEvent = { ...first, requestId: '22222222-2222-4222-8222-222222222222', eventToken: 'b'.repeat(48), createdAt: 1 };
  const later = { ...first, requestId: '33333333-3333-4333-8333-333333333333', createdAt: 300 };
  const uncertain = { ...first, requestId: '44444444-4444-4444-8444-444444444444', status: 'uncertain', createdAt: 50 };

  assert.equal(
    queue.selectNextUploadQueueItem([later, otherEvent, uncertain, first], first.eventToken).requestId,
    first.requestId,
  );
  assert.equal(queue.selectNextUploadQueueItem([uncertain], first.eventToken), null);
});

test('retry preserves the stable request ID and chooses check-before-retry for uncertain work', () => {
  const failed = queue.retryUploadQueueItem({ ...first, status: 'failed', error: 'Storage failed' });
  assert.equal(failed.requestId, first.requestId);
  assert.equal(failed.status, 'queued');
  assert.equal(failed.error, '');

  const uncertain = queue.retryUploadQueueItem({ ...first, status: 'uncertain' });
  assert.equal(uncertain.requestId, first.requestId);
  assert.equal(uncertain.status, 'needs-check');
});

test('summarizes active, queued, failed, and uncertain items for compact UI feedback', () => {
  const summary = queue.summarizeUploadQueue([
    { ...first, status: 'uploading', progress: 'Uploading photo… 42%' },
    { ...first, requestId: '2', status: 'queued' },
    { ...first, requestId: '3', status: 'failed' },
    { ...first, requestId: '4', status: 'uncertain' },
  ]);

  assert.deepEqual(summary, {
    total: 4,
    queued: 1,
    failed: 1,
    uncertain: 1,
    activeRequestId: first.requestId,
    label: 'Uploading photo… 42%',
  });
});

test('hydration merges stored work without overwriting a post queued during loading', () => {
  assert.equal(typeof queue.mergeHydratedUploadQueue, 'function');
  const newlyQueued = { ...first, requestId: '55555555-5555-4555-8555-555555555555', createdAt: 200 };
  const staleCopy = { ...first, status: 'uploading', progress: 'old' };

  const otherEvent = { ...first, requestId: '66666666-6666-4666-8666-666666666666', eventToken: 'b'.repeat(48) };
  const merged = queue.mergeHydratedUploadQueue([staleCopy, otherEvent], [first, newlyQueued, otherEvent], first.eventToken);

  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.requestId === first.requestId).status, 'queued');
  assert.equal(merged.find(item => item.requestId === newlyQueued.requestId).status, 'queued');
});

test('stale tabs cannot retry or remove an item that another tab has made active', () => {
  assert.equal(typeof queue.canRemoveUploadQueueItem, 'function');
  assert.equal(typeof queue.canRetryUploadQueueItem, 'function');
  assert.equal(queue.canRemoveUploadQueueItem({ ...first, status: 'queued' }), true);
  assert.equal(queue.canRemoveUploadQueueItem({ ...first, status: 'uploading' }), false);
  assert.equal(queue.canRemoveUploadQueueItem({ ...first, status: 'confirming' }), false);
  assert.equal(queue.canRetryUploadQueueItem({ ...first, status: 'failed' }), true);
  assert.equal(queue.canRetryUploadQueueItem({ ...first, status: 'uncertain' }), true);
  assert.equal(queue.canRetryUploadQueueItem({ ...first, status: 'uploading' }), false);
});

test('cross-tab queue work requests one exclusive lock per event', async () => {
  assert.equal(typeof queue.withUploadQueueLock, 'function');
  const calls = [];
  const locks = {
    request(name, options, callback) {
      calls.push({ name, options });
      return callback({ name });
    },
  };

  const value = await queue.withUploadQueueLock(first.eventToken, async () => 'processed', locks);

  assert.equal(value, 'processed');
  assert.deepEqual(calls, [{
    name: `sibs-snaps-upload-queue:${first.eventToken}`,
    options: { mode: 'exclusive' },
  }]);
});

test('processor optimizes and uploads one queued item with its existing request ID', async () => {
  assert.equal(typeof processor.processUploadQueueItem, 'function');
  const calls = [];
  const result = await processor.processUploadQueueItem({ ...first, file: { name: 'photo.jpg' }, author: 'Ana', caption: 'Hi' }, {
    optimize: async ({ file, requestId }) => ({ file: { ...file, name: 'photo.webp' }, requestId }),
    upload: async (eventToken, data) => {
      calls.push({ eventToken, requestId: data.requestId, fileName: data.photos[0].name });
      return { success: true, created: 1, status: 'pending' };
    },
    uploadStatus: async () => ({ state: 'unknown' }),
    onProgress() {},
  });

  assert.equal(result.outcome, 'committed');
  assert.deepEqual(calls, [{ eventToken: first.eventToken, requestId: first.requestId, fileName: 'photo.webp' }]);
});

test('processor checks an interrupted item without re-uploading it', async () => {
  let uploads = 0;
  const result = await processor.processUploadQueueItem({ ...first, status: 'needs-check' }, {
    optimize: async value => value,
    upload: async () => { uploads += 1; },
    uploadStatus: async () => ({ state: 'committed', photoId: '9' }),
    reconcile: async ({ checkStatus }) => checkStatus(),
    onProgress() {},
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(uploads, 0);
});

test('processor never automatically re-uploads an uncertain network result', async () => {
  let uploads = 0;
  const result = await processor.processUploadQueueItem({ ...first, file: { name: 'photo.jpg' } }, {
    optimize: async ({ file, requestId }) => ({ file, requestId }),
    upload: async () => {
      uploads += 1;
      throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    },
    uploadStatus: async () => { throw new Error('offline'); },
    reconcile: async () => ({ state: 'unknown' }),
    onProgress() {},
  });

  assert.equal(result.outcome, 'uncertain');
  assert.equal(uploads, 1);
});
