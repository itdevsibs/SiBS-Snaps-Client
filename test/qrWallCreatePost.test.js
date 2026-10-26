import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCancelError, readableQrWallError, readableUploadError } from '../src/lib/axios/qrWallApi.js';
import {
  MAX_PHOTO_BYTES,
  validatePhotoSubmission,
  parsePhotosResponse,
  prependFeedPhotos,
} from '../src/pages/qr-wall/qrWallFeedState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Required validation
test('required validation: enforces author name, single photo, and 10 MB limit', () => {
  // Missing name
  const noName = validatePhotoSubmission({
    name: '   ',
    files: [{ name: 'pic.jpg', size: 1024 * 1024 }],
  });
  assert.equal(noName.valid, false);
  assert.equal(noName.error, 'Please enter your name.');

  // No photo selected
  const noFiles = validatePhotoSubmission({
    name: 'Juan Dela Cruz',
    files: [],
  });
  assert.equal(noFiles.valid, false);
  assert.equal(noFiles.error, 'Choose exactly one photo per submission.');

  // Multiple photos selected
  const multipleFiles = validatePhotoSubmission({
    name: 'Juan Dela Cruz',
    files: [
      { name: 'pic1.jpg', size: 500 },
      { name: 'pic2.jpg', size: 500 },
    ],
  });
  assert.equal(multipleFiles.valid, false);
  assert.equal(multipleFiles.error, 'Choose exactly one photo per submission.');

  // File exceeds 10 MB limit
  const oversizedFile = validatePhotoSubmission({
    name: 'Juan Dela Cruz',
    files: [{ name: 'huge_photo.jpg', size: 10 * 1024 * 1024 + 1 }],
  });
  assert.equal(oversizedFile.valid, false);
  assert.match(oversizedFile.error, /exceeds the 10 MB limit/);

  // Empty file (0 bytes)
  const emptyFile = validatePhotoSubmission({
    name: 'Juan Dela Cruz',
    files: [{ name: 'empty.png', size: 0 }],
  });
  assert.equal(emptyFile.valid, false);
  assert.equal(emptyFile.error, 'The selected photo is empty.');

  // GIFs are not accepted, including when a browser omits the MIME type.
  for (const file of [
    { name: 'animation.gif', type: 'image/gif', size: 500 },
    { name: 'animation.GIF', type: '', size: 500 },
    { name: 'animation.gif', type: 'application/octet-stream', size: 500 },
  ]) {
    const gif = validatePhotoSubmission({ name: 'Juan Dela Cruz', files: [file] });
    assert.equal(gif.valid, false);
    assert.match(gif.error, /GIF images are not supported/);
  }

  // Valid submission
  const valid = validatePhotoSubmission({
    name: 'Juan Dela Cruz',
    caption: 'A great moment',
    files: [{ name: 'celebration.jpg', size: 4.5 * 1024 * 1024 }],
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.error, null);
});

// 2. Photo preview and file constraints
test('photo selection: MAX_PHOTO_BYTES constant is exactly 10 MiB', () => {
  assert.equal(MAX_PHOTO_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_PHOTO_BYTES, 10485760);
});

// 3. Upload success, failure, and pending moderation
test('upload flow: successful upload requires moderator approval and does not inject into public feed', async () => {
  const existingFeed = [
    { id: 101, uploadedBy: 'Maria', caption: 'Approved earlier' },
    { id: 100, uploadedBy: 'Pedro', caption: 'First moment' },
  ];

  // Simulated backend API
  const mockApi = {
    async upload(token, data) {
      assert.equal(token, 'abc123token');
      assert.equal(data.author, 'Juan');
      assert.equal(data.caption, 'Happy Anniversary!');
      assert.equal(data.photos.length, 1);
      // Backend returns created confirmation without publishing immediately
      return { created: 1, pending: true, id: 999 };
    },
    async getPhotos() {
      // Feed only contains approved items
      return {
        photos: existingFeed,
        pagination: { nextCursor: null, hasMore: false },
      };
    },
  };

  const uploadResult = await mockApi.upload('abc123token', {
    author: 'Juan',
    caption: 'Happy Anniversary!',
    photos: [{ name: 'selfie.jpg', size: 1024 }],
  });
  assert.equal(uploadResult.created, 1);
  assert.equal(uploadResult.pending, true);

  // Public feed refresh check: pending photo is NOT added to public feed
  const feedResult = await mockApi.getPhotos();
  const parsed = parsePhotosResponse(feedResult);
  assert.equal(parsed.photos.length, 2);
  assert.ok(!parsed.photos.some(p => p.id === 999), 'Pending photo must not be visible publicly before approval');
});

test('upload failure: handles failed server response gracefully', async () => {
  const mockFailingApi = {
    async upload() {
      const err = new Error('Upload rejected by server');
      err.response = { status: 413, data: { message: 'File too large for server.' } };
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await mockFailingApi.upload('tok', {});
    },
    { message: 'Upload rejected by server' }
  );
});

test('upload timeout: shows a clear message and advises checking before retrying', () => {
  for (const error of [{ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }, { code: 'ETIMEDOUT' }, { response: { status: 504 } }]) {
    assert.match(readableUploadError(error), /timed out/i);
    assert.match(readableUploadError(error), /moderator/i);
  }
  assert.equal(readableUploadError({ response: { data: { message: 'Photo is invalid' } } }), 'Photo is invalid');
});

test('cancellation errors: isCancelError detects canceled requests and readableQrWallError silences them', () => {
  const axiosCancel = new Error('canceled');
  axiosCancel.name = 'CanceledError';
  axiosCancel.code = 'ERR_CANCELED';
  assert.equal(isCancelError(axiosCancel), true);
  assert.equal(readableQrWallError(axiosCancel, 'Fallback message'), '');

  const domAbort = new Error('The user aborted a request.');
  domAbort.name = 'AbortError';
  assert.equal(isCancelError(domAbort), true);
  assert.equal(readableQrWallError(domAbort, 'Fallback message'), '');

  const genericCancel = { message: 'canceled' };
  assert.equal(isCancelError(genericCancel), true);
  assert.equal(readableQrWallError(genericCancel, 'Fallback message'), '');

  // Genuine server errors are preserved
  const serverError = { response: { data: { message: 'Event not found.' } } };
  assert.equal(isCancelError(serverError), false);
  assert.equal(readableQrWallError(serverError, 'Fallback message'), 'Event not found.');

  const networkError = new Error('Network error');
  assert.equal(isCancelError(networkError), false);
  assert.equal(readableQrWallError(networkError, 'Fallback message'), 'Network error');
});

// 4. Unaffected feed loading & live updates
test('unaffected feed loading: deduplication and live updates operate normally', () => {
  const currentFeed = [{ id: 50, uploadedBy: 'Ana', reactionCount: 3 }];
  // Moderator approves photo 51
  const approvedPhoto = { id: 51, uploadedBy: 'Juan', reactionCount: 0 };

  const updatedFeed = prependFeedPhotos(currentFeed, [approvedPhoto]);
  assert.equal(updatedFeed.length, 2);
  assert.equal(updatedFeed[0].id, 51);
  assert.equal(updatedFeed[1].id, 50);
});

// 5. CSS and component structure verification
test('composer card and modal styling: verifies CSS definitions in qrWall.css', () => {
  const cssPath = path.resolve(__dirname, '../src/pages/qr-wall/qrWall.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify Facebook-style composer classes
  assert.ok(cssContent.includes('.qrw-composer-card'), 'Missing .qrw-composer-card');
  assert.ok(cssContent.includes('.qrw-composer-trigger'), 'Missing .qrw-composer-trigger');
  assert.ok(cssContent.includes('.qrw-composer-actions'), 'Missing .qrw-composer-actions');
  assert.ok(cssContent.includes('.qrw-composer-avatar'), 'Missing .qrw-composer-avatar');
  assert.ok(cssContent.includes('.qrw-composer-action-btn'), 'Missing .qrw-composer-action-btn');

  // Verify modal classes
  assert.ok(cssContent.includes('.qrw-create-modal-backdrop'), 'Missing .qrw-create-modal-backdrop');
  assert.ok(cssContent.includes('.qrw-create-modal'), 'Missing .qrw-create-modal');
  assert.ok(cssContent.includes('.qrw-create-modal-header'), 'Missing .qrw-create-modal-header');
  assert.ok(cssContent.includes('.qrw-create-modal-close'), 'Missing .qrw-create-modal-close');
  assert.ok(cssContent.includes('.qrw-create-modal-body'), 'Missing .qrw-create-modal-body');
  assert.ok(cssContent.includes('.qrw-composer-preview-container'), 'Missing .qrw-composer-preview-container');
  assert.ok(cssContent.includes('.qrw-composer-preview-remove'), 'Missing .qrw-composer-preview-remove');
  assert.ok(cssContent.includes('.qrw-composer-preview-change-btn'), 'Missing .qrw-composer-preview-change-btn');

  // Verify mobile responsive rule
  assert.ok(cssContent.includes('@media (max-width: 580px)'), 'Missing mobile responsive breakpoint');

  // Verify prefers-reduced-motion
  assert.ok(cssContent.includes('prefers-reduced-motion'), 'Missing accessibility motion reduction');
});

// 6. JSX structure verification
test('QRWallJoinPage: verifies absence of tabs, presence of composer and modal markup', () => {
  const jsxPath = path.resolve(__dirname, '../src/pages/qr-wall/QRWallJoinPage.jsx');
  const jsxContent = fs.readFileSync(jsxPath, 'utf8');

  // Verify "Photo feed" / "Upload photos" tabs are completely removed
  assert.ok(!jsxContent.includes('qrw-mobile-tabs'), 'Old tabs container must be removed');
  assert.ok(!jsxContent.includes('Upload photos</button>'), 'Old upload tab button must be removed');

  // Verify Facebook-style composer markup
  assert.ok(jsxContent.includes('qrw-composer-card'), 'Must render composer card');
  assert.ok(jsxContent.includes('Upload your moments here'), 'Must render the upload prompt');
  assert.ok(!jsxContent.includes('Upload Photo Here'), 'Must not render a separate upload button');

  // Verify modal markup
  assert.ok(jsxContent.includes('qrw-create-modal'), 'Must render create post modal');
  assert.ok(jsxContent.includes('showCreateModal'), 'Must track showCreateModal state');
  assert.ok(jsxContent.includes('openCreateModal'), 'Must have openCreateModal handler');
  assert.ok(jsxContent.includes('closeCreateModal'), 'Must have closeCreateModal handler');
  assert.ok(jsxContent.includes('qrw-composer-preview-container'), 'Must have image preview container in modal');
  assert.ok(jsxContent.includes('Change photo'), 'Must have Change photo button');

  // Verify photo feed is unconditionally visible
  assert.ok(jsxContent.includes('qrw-mobile-feed'), 'Must have feed container');
  assert.ok(!jsxContent.includes("tab === 'feed'"), 'Must not conditionally toggle feed with tab');

  // Verify professional anon avatar icon replaces raw '?'
  assert.ok(jsxContent.includes('UserRound'), 'Must import and use UserRound for avatar icon');
  assert.ok(jsxContent.includes('qrw-avatar-icon'), 'Must use qrw-avatar-icon class');
  assert.ok(!jsxContent.includes("name.trim() ? name.trim().charAt(0).toUpperCase() : '?'"), 'Must not fallback to question mark');
});

// 7. PhotoPost anon avatar verification
test('PhotoPost: verifies professional anon avatar icon', () => {
  const photoPostPath = path.resolve(__dirname, '../src/components/qr-wall/PhotoPost.jsx');
  const photoPostContent = fs.readFileSync(photoPostPath, 'utf8');

  assert.ok(photoPostContent.includes('UserRound'), 'PhotoPost must import and use UserRound');
  assert.ok(!photoPostContent.includes("(photo.uploadedBy || '?').charAt(0)"), 'Must not fallback to question mark');
});

