import test from 'node:test';
import assert from 'node:assert/strict';

import { createQrWallApi } from '../src/lib/axios/qrWallApi.js';

const TOKEN = '1111222233334444555566667777888899990000aaaabbbb';
const REQUEST_ID = '2f6b93a8-4f42-4e6d-b449-89cb755f9714';

test('photo upload uses its dedicated timeout, idempotency header, and progress callback', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://snaps.example.com' } };
  const calls = [];
  const http = {
    defaults: { baseURL: '' },
    get() {}, patch() {},
    async post(...args) {
      calls.push(args);
      return { data: { success: true, created: 1 } };
    },
  };
  try {
    let progress = null;
    const api = createQrWallApi(http);
    await api.upload(TOKEN, {
      photos: [new Blob(['photo'], { type: 'image/jpeg' })],
      author: 'Guest',
      caption: 'Moment',
      requestId: REQUEST_ID,
      onUploadProgress: event => { progress = event.loaded; },
    });

    const [url, body, config] = calls[0];
    assert.equal(url, `/api/qr-wall/public/${TOKEN}/photos`);
    assert.equal(body.get('author'), 'Guest');
    assert.equal(config.timeout, 120000);
    assert.deepEqual(config.headers, { 'X-SiBS-Snaps-Upload-Id': REQUEST_ID });
    config.onUploadProgress({ loaded: 5, total: 10 });
    assert.equal(progress, 5);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('upload status lookup is scoped to the event token and request UUID', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://snaps.example.com' } };
  const calls = [];
  const http = {
    defaults: { baseURL: '' },
    async get(...args) { calls.push(args); return { data: { success: true, state: 'committed' } }; },
    post() {}, patch() {},
  };
  try {
    const api = createQrWallApi(http);
    await api.uploadStatus(TOKEN, REQUEST_ID);
    assert.equal(calls[0][0], `/api/qr-wall/public/${TOKEN}/uploads/${REQUEST_ID}`);
    assert.equal(calls[0][1].timeout, 30000);
  } finally {
    globalThis.window = previousWindow;
  }
});
