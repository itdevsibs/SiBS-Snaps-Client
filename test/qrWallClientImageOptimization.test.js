import test from 'node:test';
import assert from 'node:assert/strict';

import {
  optimizePhotoForUpload,
  preparePhotoUpload,
} from '../src/pages/qr-wall/optimizePhotoForUpload.js';

function photoFile({
  name = 'photo.jpg',
  type = 'image/jpeg',
  size = 1_200_000,
} = {}) {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1234 });
}

function optimizerDependencies({ width, height, outputBytes, failDecode = false, failEncode = false }) {
  const calls = { decode: 0, encode: 0, close: 0, encodeOptions: null };
  return {
    calls,
    dependencies: {
      async decode() {
        calls.decode += 1;
        if (failDecode) throw new Error('decode failed');
        return {
          source: { kind: 'decoded-photo' },
          width,
          height,
          close() { calls.close += 1; },
        };
      },
      async encode(options) {
        calls.encode += 1;
        calls.encodeOptions = options;
        if (failEncode) throw new Error('encode failed');
        return new Blob([new Uint8Array(outputBytes)], { type: 'image/webp' });
      },
    },
  };
}

test('optimizes a JPEG over 1 MiB even when its dimensions are already small', async () => {
  const original = photoFile({ size: 1_200_000 });
  const { dependencies, calls } = optimizerDependencies({ width: 1200, height: 800, outputBytes: 300_000 });

  const result = await optimizePhotoForUpload(original, dependencies);

  assert.equal(result.optimized, true);
  assert.equal(result.originalBytes, 1_200_000);
  assert.equal(result.uploadBytes, 300_000);
  assert.equal(result.file.type, 'image/webp');
  assert.equal(result.file.name, 'photo.webp');
  assert.equal(calls.encodeOptions.width, 1200);
  assert.equal(calls.encodeOptions.height, 800);
  assert.equal(calls.close, 1);
});

test('accepts the image/jpg MIME alias used by some browser file pickers', async () => {
  const original = photoFile({ name: 'camera.jpg', type: 'image/jpg', size: 1_200_000 });
  const { dependencies } = optimizerDependencies({ width: 1200, height: 800, outputBytes: 300_000 });

  const result = await optimizePhotoForUpload(original, dependencies);

  assert.equal(result.optimized, true);
  assert.equal(result.file.type, 'image/webp');
});

test('optimizes HEIC and HEIF photos when the browser can decode them', async () => {
  for (const [name, type] of [
    ['iphone.heic', 'image/heic'],
    ['iphone.heif', 'image/heif'],
    ['iphone-sequence.heic', 'image/heic-sequence'],
    ['iphone-no-mime.HEIC', ''],
  ]) {
    const original = photoFile({ name, type, size: 1_200_000 });
    const { dependencies, calls } = optimizerDependencies({
      width: 3024,
      height: 4032,
      outputBytes: 300_000,
    });

    const result = await optimizePhotoForUpload(original, dependencies);

    assert.equal(result.optimized, true, `${name} should be optimized`);
    assert.equal(result.file.type, 'image/webp');
    assert.equal(calls.encodeOptions.width, 1440);
    assert.equal(calls.encodeOptions.height, 1920);
  }
});

test('optimizes an oversized PNG and fits it within 1920px without changing aspect ratio', async () => {
  const original = photoFile({ name: 'portrait.png', type: 'image/png', size: 200_000 });
  const { dependencies, calls } = optimizerDependencies({ width: 3000, height: 4000, outputBytes: 100_000 });

  const result = await optimizePhotoForUpload(original, dependencies);

  assert.equal(result.optimized, true);
  assert.equal(calls.encodeOptions.width, 1440);
  assert.equal(calls.encodeOptions.height, 1920);
  assert.equal(calls.encodeOptions.quality, 0.82);
});

test('skips formats whose animation or browser compatibility must be preserved', async () => {
  for (const [name, type] of [
    ['animation.gif', 'image/gif'],
    ['photo.avif', 'image/avif'],
    ['photo.webp', 'image/webp'],
  ]) {
    const original = photoFile({ name, type, size: 2_000_000 });
    const { dependencies, calls } = optimizerDependencies({ width: 4000, height: 3000, outputBytes: 100_000 });
    const result = await optimizePhotoForUpload(original, dependencies);
    assert.equal(result.file, original, `${type} must remain untouched`);
    assert.equal(result.optimized, false);
    assert.equal(calls.decode, 0);
    assert.equal(calls.encode, 0);
  }
});

test('keeps the original when the WebP saves less than 10 percent', async () => {
  const original = photoFile({ size: 1_200_000 });
  const { dependencies } = optimizerDependencies({ width: 2400, height: 1600, outputBytes: 1_100_000 });

  const result = await optimizePhotoForUpload(original, dependencies);

  assert.equal(result.file, original);
  assert.equal(result.optimized, false);
  assert.equal(result.uploadBytes, 1_200_000);
});

test('keeps the original when browser decoding or encoding fails', async () => {
  const original = photoFile({ size: 1_200_000 });
  for (const failure of [{ failDecode: true }, { failEncode: true }]) {
    const { dependencies } = optimizerDependencies({
      width: 2400,
      height: 1600,
      outputBytes: 200_000,
      ...failure,
    });
    const result = await optimizePhotoForUpload(original, dependencies);
    assert.equal(result.file, original);
    assert.equal(result.optimized, false);
    assert.equal(result.uploadBytes, original.size);
  }
});

test('keeps a small JPEG at or below 1920px without encoding it', async () => {
  const original = photoFile({ size: 200_000 });
  const { dependencies, calls } = optimizerDependencies({ width: 1920, height: 1080, outputBytes: 50_000 });

  const result = await optimizePhotoForUpload(original, dependencies);

  assert.equal(result.file, original);
  assert.equal(result.optimized, false);
  assert.equal(calls.decode, 1);
  assert.equal(calls.encode, 0);
  assert.equal(calls.close, 1);
});

test('prepares the smaller file without changing the submission request ID', async () => {
  const original = photoFile({ size: 1_200_000 });
  const requestId = '2f6b93a8-4f42-4e6d-b449-89cb755f9714';
  const { dependencies } = optimizerDependencies({ width: 2400, height: 1600, outputBytes: 250_000 });

  const prepared = await preparePhotoUpload({ file: original, requestId }, dependencies);

  assert.equal(prepared.requestId, requestId);
  assert.equal(prepared.file.type, 'image/webp');
  assert.equal(prepared.file.size, 250_000);
  assert.equal(prepared.optimized, true);
});
