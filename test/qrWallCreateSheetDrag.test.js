import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCreateSheetBackdropAlpha,
  getCreateSheetDragOffset,
  shouldDismissCreateSheet,
} from '../src/pages/qr-wall/qrWallCreateSheetDrag.js';

test('create sheet only follows downward drag movement', () => {
  assert.equal(getCreateSheetDragOffset(-80), 0);
  assert.equal(getCreateSheetDragOffset(0), 0);
  assert.equal(getCreateSheetDragOffset(55), 55);
});

test('create sheet dismisses after enough downward distance or velocity', () => {
  assert.equal(shouldDismissCreateSheet({ offsetY: 90, velocityY: 0.2 }), true);
  assert.equal(shouldDismissCreateSheet({ offsetY: 30, velocityY: 0.7 }), true);
  assert.equal(shouldDismissCreateSheet({ offsetY: 89, velocityY: 0.69 }), false);
  assert.equal(shouldDismissCreateSheet({ offsetY: -120, velocityY: -1 }), false);
});

test('create sheet drag fades the backdrop without making it transparent', () => {
  assert.equal(getCreateSheetBackdropAlpha(0, 800), 0.72);
  const dragged = getCreateSheetBackdropAlpha(240, 800);
  assert.ok(dragged < 0.72);
  assert.ok(dragged >= 0.28);
});
