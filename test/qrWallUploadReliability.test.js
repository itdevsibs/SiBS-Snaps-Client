import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUploadRequestId,
  isUncertainUploadError,
  reconcileUploadStatus,
  uploadProgressLabel,
} from '../src/pages/qr-wall/qrWallUploadReliability.js';

const REQUEST_ID = '2f6b93a8-4f42-4e6d-b449-89cb755f9714';

test('creates one normalized UUID for a submission', () => {
  assert.equal(createUploadRequestId(() => REQUEST_ID.toUpperCase()), REQUEST_ID);
  assert.throws(() => createUploadRequestId(() => 'bad-id'), /UUID/i);
});

test('distinguishes ambiguous network outcomes from confirmed HTTP failures', () => {
  for (const error of [
    { code: 'ECONNABORTED', request: {} },
    { code: 'ETIMEDOUT', request: {} },
    { code: 'ERR_NETWORK', request: {} },
    { message: 'Network Error', request: {} },
  ]) assert.equal(isUncertainUploadError(error), true);

  assert.equal(isUncertainUploadError({ response: { status: 422 }, code: 'ERR_BAD_REQUEST' }), false);
  assert.equal(isUncertainUploadError({ response: { status: 503 }, code: 'ERR_BAD_RESPONSE' }), false);
});

test('reports upload bytes before switching to server processing feedback', () => {
  assert.equal(uploadProgressLabel({ loaded: 25, total: 100 }), 'Uploading photo… 25%');
  assert.equal(uploadProgressLabel({ loaded: 100, total: 100 }), 'Processing photo securely…');
  assert.equal(uploadProgressLabel({ loaded: 10, total: 0 }), 'Uploading photo…');
});

test('reconciles processing and unknown outcomes without re-uploading', async () => {
  const states = [
    { state: 'unknown', photoId: null },
    { state: 'processing', photoId: null },
    { state: 'committed', photoId: '44', status: 'pending' },
  ];
  let checks = 0;
  let waits = 0;
  const result = await reconcileUploadStatus({
    requestId: REQUEST_ID,
    checkStatus: async () => states[checks++],
    wait: async () => { waits += 1; },
    maxChecks: 5,
  });

  assert.equal(result.state, 'committed');
  assert.equal(result.photoId, '44');
  assert.equal(checks, 3);
  assert.equal(waits, 2);
});

test('stops reconciliation on a confirmed server failure', async () => {
  const result = await reconcileUploadStatus({
    requestId: REQUEST_ID,
    checkStatus: async () => ({ state: 'failed', photoId: null }),
    wait: async () => { throw new Error('must not wait after failure'); },
  });
  assert.deepEqual(result, { state: 'failed', photoId: null });
});

