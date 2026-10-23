import test from 'node:test';
import assert from 'node:assert/strict';

import { getPhotoLoadStatus, shouldShowPhotoLoader } from '../src/components/qr-wall/photoLoadingState.js';

test('photo loading status stops animating after success or failure', () => {
  assert.equal(getPhotoLoadStatus({ loaded: false, failed: false }), 'loading');
  assert.equal(getPhotoLoadStatus({ loaded: true, failed: false }), 'loaded');
  assert.equal(getPhotoLoadStatus({ loaded: false, failed: true }), 'error');
  assert.equal(getPhotoLoadStatus({ loaded: true, failed: true }), 'error');
});

test('a loaded thumbnail replaces the loading panel while the feed image finishes', () => {
  assert.equal(shouldShowPhotoLoader({ loaded: false, failed: false, previewLoaded: false }), true);
  assert.equal(shouldShowPhotoLoader({ loaded: false, failed: false, previewLoaded: true }), false);
  assert.equal(shouldShowPhotoLoader({ loaded: true, failed: false, previewLoaded: false }), false);
  assert.equal(shouldShowPhotoLoader({ loaded: false, failed: true, previewLoaded: false }), false);
});
