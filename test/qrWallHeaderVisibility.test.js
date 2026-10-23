import test from 'node:test';
import assert from 'node:assert/strict';

import { getHeaderPresentationClass, getHeaderVisibility } from '../src/pages/qr-wall/qrWallHeaderVisibility.js';

test('keeps the mobile header visible at the top of the page', () => {
  assert.equal(getHeaderVisibility({ previousY: 120, currentY: 0, visible: false }), true);
});

test('hides the mobile header after a meaningful downward scroll', () => {
  assert.equal(getHeaderVisibility({ previousY: 40, currentY: 55, visible: true }), false);
});

test('reveals the mobile header after a meaningful upward scroll', () => {
  assert.equal(getHeaderVisibility({ previousY: 180, currentY: 165, visible: false }), true);
});

test('ignores tiny scroll movements that would make the header jitter', () => {
  assert.equal(getHeaderVisibility({ previousY: 100, currentY: 104, visible: true }), true);
  assert.equal(getHeaderVisibility({ previousY: 100, currentY: 96, visible: false }), false);
});

test('suspends the header while either modal is open', () => {
  assert.equal(getHeaderPresentationClass({ visible: true, modalOpen: true }), 'is-visible is-suspended');
  assert.equal(getHeaderPresentationClass({ visible: false, modalOpen: true }), 'is-hidden is-suspended');
  assert.equal(getHeaderPresentationClass({ visible: true, modalOpen: false }), 'is-visible');
  assert.equal(getHeaderPresentationClass({ visible: false, modalOpen: false }), 'is-hidden');
});
