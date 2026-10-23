import assert from 'node:assert/strict';
import test from 'node:test';

import { splitCaption } from '../src/components/qr-wall/captionText.js';

test('splitCaption identifies hashtag tokens without changing caption text', () => {
  const caption = '#SiBS@15 thank you  #TeamSnaps!';
  const parts = splitCaption(caption);

  assert.equal(parts.map(part => part.text).join(''), caption);
  assert.deepEqual(parts.filter(part => part.isHashtag).map(part => part.text), [
    '#SiBS@15',
    '#TeamSnaps!',
  ]);
  assert.deepEqual(parts.filter(part => !part.isHashtag).map(part => part.text), [
    ' ',
    'thank',
    ' ',
    'you',
    '  ',
  ]);
});

test('splitCaption leaves ordinary caption tokens unhighlighted', () => {
  assert.deepEqual(splitCaption('Happy birthday'), [
    { text: 'Happy', isHashtag: false },
    { text: ' ', isHashtag: false },
    { text: 'birthday', isHashtag: false },
  ]);
});
