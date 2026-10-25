import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UPLOAD_CONFIRMATION_DURATION_MS,
  isConfirmedPhotoUpload,
} from '../src/pages/qr-wall/qrWallUploadConfirmation.js';

test('confirms only a response that created exactly one photo', () => {
  assert.equal(isConfirmedPhotoUpload({ created: 1 }), true);
  assert.equal(isConfirmedPhotoUpload({ created: '1' }), true);

  for (const response of [
    undefined,
    null,
    {},
    { created: 0 },
    { created: 2 },
    { created: true },
    { created: [1] },
    { created: 'not-a-number' },
  ]) {
    assert.equal(isConfirmedPhotoUpload(response), false);
  }
});

test('keeps the upload confirmation visible for three seconds', () => {
  assert.equal(UPLOAD_CONFIRMATION_DURATION_MS, 3000);
});
