import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getViewerDragPresentation,
  getViewerDismissTarget,
  getViewerScrollTransfer,
  restoreViewerScrollPosition,
  shouldDismissViewerDrag,
} from '../src/pages/qr-wall/qrWallViewerDrag.js';

test('short viewer drags spring back instead of dismissing', () => {
  assert.equal(shouldDismissViewerDrag({ offsetY: 45, velocityY: 0.2 }), false);
  assert.equal(shouldDismissViewerDrag({ offsetY: -45, velocityY: -0.2 }), false);
});

test('long or fast viewer drags dismiss in either vertical direction', () => {
  assert.equal(shouldDismissViewerDrag({ offsetY: 100, velocityY: 0.2 }), true);
  assert.equal(shouldDismissViewerDrag({ offsetY: -100, velocityY: -0.2 }), true);
  assert.equal(shouldDismissViewerDrag({ offsetY: 30, velocityY: 0.8 }), true);
  assert.equal(shouldDismissViewerDrag({ offsetY: -30, velocityY: -0.8 }), true);
});

test('viewer drag gently shrinks the modal and fades its backdrop', () => {
  assert.deepEqual(getViewerDragPresentation(0, 800), { scale: 1, backdropAlpha: 0.88 });
  const dragged = getViewerDragPresentation(180, 800);
  assert.ok(dragged.scale < 1 && dragged.scale >= 0.92);
  assert.ok(dragged.backdropAlpha < 0.88 && dragged.backdropAlpha >= 0.3);
});

test('dismiss target follows the drag direction beyond the viewport', () => {
  assert.equal(getViewerDismissTarget(100, 800), 920);
  assert.equal(getViewerDismissTarget(-100, 800), -920);
});

test('dismiss gesture transfers its distance and momentum into the feed scroll', () => {
  assert.deepEqual(getViewerScrollTransfer({
    scrollY: 1000,
    offsetY: -120,
    velocityY: -1,
    maxScrollY: 3000,
  }), { restoreY: 1120, momentumTargetY: 1340 });

  assert.deepEqual(getViewerScrollTransfer({
    scrollY: 1000,
    offsetY: 120,
    velocityY: 1,
    maxScrollY: 3000,
  }), { restoreY: 880, momentumTargetY: 660 });
});

test('restores the feed position instantly even when the page normally uses smooth scrolling', () => {
  const rootStyle = { scrollBehavior: '' };
  const bodyStyle = { position: 'fixed', top: '-640px', overflow: 'hidden' };
  let restoredPosition = null;
  let behaviorDuringRestore = null;

  restoreViewerScrollPosition({
    rootStyle,
    bodyStyle,
    originalBodyStyle: { position: '', top: '', overflow: '' },
    originalRootScrollBehavior: '',
    scrollY: 640,
    scrollTo: (x, y) => {
      restoredPosition = [x, y];
      behaviorDuringRestore = rootStyle.scrollBehavior;
    },
  });

  assert.deepEqual(restoredPosition, [0, 640]);
  assert.equal(behaviorDuringRestore, 'auto');
  assert.deepEqual(bodyStyle, { position: '', top: '', overflow: '' });
  assert.equal(rootStyle.scrollBehavior, '');
});
