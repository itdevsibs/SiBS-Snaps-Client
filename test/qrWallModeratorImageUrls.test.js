import test from 'node:test';
import assert from 'node:assert/strict';

import { createQrWallApi } from '../src/lib/axios/qrWallApi.js';

test('moderator image URLs request the intended stored variant', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: { origin: 'http://localhost:5173' },
    localStorage: { getItem: () => null, setItem: () => {} },
    crypto: { getRandomValues: bytes => bytes.fill(1) },
  };

  try {
    const http = {
      defaults: { baseURL: 'http://localhost:5001/api' },
      get() {}, post() {}, patch() {}, delete() {},
    };
    const api = createQrWallApi(http);

    assert.equal(
      api.moderatorPhotoUrl(42, 'thumbnail'),
      'http://localhost:5001/api/qr-wall/moderator/photos/42/image?variant=thumbnail',
    );
    assert.equal(
      api.moderatorPhotoUrl(42, 'feed'),
      'http://localhost:5001/api/qr-wall/moderator/photos/42/image?variant=feed',
    );
  } finally {
    globalThis.window = previousWindow;
  }
});
