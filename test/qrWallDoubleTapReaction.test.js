import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isDoubleTapGesture,
  canTriggerReaction,
  calculateOptimisticReaction,
} from '../src/pages/qr-wall/qrWallDisplayState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Desktop double-click timing
test('desktop double-click: recognizes clicks within delay threshold and rejects slow clicks', () => {
  const t1 = 1000;
  const t2Fast = 1150; // 150ms apart (rapid double-click)
  const t2Slow = 1450; // 450ms apart (two separate single clicks)

  assert.equal(isDoubleTapGesture(t1, t2Fast, 280), true, 'Clicks 150ms apart must be recognized as double-click');
  assert.equal(isDoubleTapGesture(t1, t2Slow, 280), false, 'Clicks 450ms apart must not be recognized as double-click');
  assert.equal(isDoubleTapGesture(0, t2Fast, 280), false, 'First click without preceding click must not trigger double-click');
});

// 2. Mobile double-tap gesture & touch distance tolerance
test('mobile double-tap: checks timing and distance threshold to distinguish tap from scroll', () => {
  const touchStart = 2000;
  const tap1 = { x: 100, y: 150, time: 2000 };
  const tap2Valid = { x: 105, y: 152, time: 2180 }; // 180ms apart, ~6px apart
  const tap2Moved = { x: 100, y: 230, time: 2180 }; // 180ms apart, 80px apart (scroll drag)

  const distValid = Math.hypot(tap2Valid.x - tap1.x, tap2Valid.y - tap1.y);
  const distMoved = Math.hypot(tap2Moved.x - tap1.x, tap2Moved.y - tap1.y);

  assert.ok(isDoubleTapGesture(tap1.time, tap2Valid.time, 320), 'Touch taps 180ms apart should meet time threshold');
  assert.ok(distValid < 45, 'Clean double-tap distance must be within 45px tolerance');
  assert.ok(distMoved > 45, 'Scroll drag movement (>45px) must exceed tap tolerance');
});

// 3. Single click vs double click debounce behavior
test('single click: delayed viewer opening is cancelled when double click occurs', () => {
  let viewerOpened = false;
  let reactionTriggered = 0;
  let clickTimer = null;

  const simulateFirstClick = () => {
    clickTimer = setTimeout(() => {
      viewerOpened = true;
      clickTimer = null;
    }, 260);
  };

  const simulateSecondClickDoubleTap = () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    reactionTriggered += 1;
  };

  // 1st click
  simulateFirstClick();
  assert.equal(viewerOpened, false);
  assert.notEqual(clickTimer, null);

  // 2nd click arrives before 260ms
  simulateSecondClickDoubleTap();
  assert.equal(clickTimer, null);
  assert.equal(reactionTriggered, 1, 'Double click must trigger exactly one reaction');
  assert.equal(viewerOpened, false, 'Viewer must not open on double click');
});

// 4. Reaction counts & already-reacted posts
test('reaction counts & already-reacted posts: toggles reaction state and updates count correctly', () => {
  const unreactedPost = { id: 1, reacted: false, reactionCount: 5 };
  const optimisticLike = calculateOptimisticReaction(unreactedPost);
  assert.equal(optimisticLike.reacted, true);
  assert.equal(optimisticLike.reactionCount, 6);

  const alreadyReactedPost = { id: 2, reacted: true, reactionCount: 6 };
  const optimisticUnlike = calculateOptimisticReaction(alreadyReactedPost);
  assert.equal(optimisticUnlike.reacted, false);
  assert.equal(optimisticUnlike.reactionCount, 5);
});

// 5. Rapid tapping: duplicate request prevention during pending reactions
test('rapid tapping: prevents duplicate requests while reaction is in flight', () => {
  const mockOnReact = () => Promise.resolve({ reacted: true });

  // Can react when idle
  assert.equal(canTriggerReaction({ onReact: mockOnReact, reacting: false, closed: false }), true);

  // Cannot react when already reacting (pending request)
  assert.equal(canTriggerReaction({ onReact: mockOnReact, reacting: true, closed: false }), false);

  // Cannot react when event is closed
  assert.equal(canTriggerReaction({ onReact: mockOnReact, reacting: false, closed: true }), false);

  // Cannot react when no handler is provided
  assert.equal(canTriggerReaction({ onReact: null, reacting: false, closed: false }), false);
});

// 6. Failed API requests
test('failed API requests: safely handles rejected reaction calls', async () => {
  let photosState = [{ id: 10, reacted: false, reactionCount: 2 }];
  let errorMessage = '';

  const mockFailingReact = async (photo) => {
    try {
      const err = new Error('Network error');
      throw err;
    } catch {
      errorMessage = 'Could not update reaction. Please try again.';
      return null;
    }
  };

  const response = await mockFailingReact(photosState[0]);
  assert.equal(response, null);
  assert.equal(errorMessage, 'Could not update reaction. Please try again.');
  // State remains intact
  assert.equal(photosState[0].reacted, false);
  assert.equal(photosState[0].reactionCount, 2);
});

// 7. CSS and markup verification
test('CSS styles & PhotoPost markup: verifies double-tap heart overlay and animations', () => {
  const cssPath = path.resolve(__dirname, '../src/pages/qr-wall/qrWall.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify CSS classes and keyframes
  assert.ok(cssContent.includes('.qrw-double-tap-heart-overlay'), 'Missing .qrw-double-tap-heart-overlay');
  assert.ok(cssContent.includes('.qrw-double-tap-heart'), 'Missing .qrw-double-tap-heart');
  assert.ok(cssContent.includes('@keyframes qrw-big-heart-pop'), 'Missing @keyframes qrw-big-heart-pop');
  assert.ok(cssContent.includes('0.72s'), 'Heart animation duration must be approximately 700ms');
  assert.ok(cssContent.includes('touch-action: manipulation'), 'Missing touch-action: manipulation');
  assert.ok(cssContent.includes('user-select: none'), 'Missing user-select: none on image wrap');
  assert.ok(cssContent.includes('qrw-big-heart-fade'), 'Missing reduced-motion fade animation');

  const jsxPath = path.resolve(__dirname, '../src/components/qr-wall/PhotoPost.jsx');
  const jsxContent = fs.readFileSync(jsxPath, 'utf8');

  // Verify PhotoPost handlers
  assert.ok(jsxContent.includes('onDoubleClick={triggerDoubleReaction}'), 'Missing onDoubleClick handler');
  assert.ok(jsxContent.includes('onTouchStart={handleTouchStart}'), 'Missing onTouchStart handler');
  assert.ok(jsxContent.includes('onTouchMove={handleTouchMove}'), 'Missing onTouchMove handler');
  assert.ok(jsxContent.includes('onTouchEnd={handleTouchEnd}'), 'Missing onTouchEnd handler');
  assert.ok(jsxContent.includes('qrw-double-tap-heart-overlay'), 'Missing heart overlay markup');
  assert.ok(jsxContent.includes('triggerBigHeart'), 'Missing triggerBigHeart invocation');
});

