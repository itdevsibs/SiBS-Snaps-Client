const OPTIMIZABLE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const OPTIMIZABLE_EXTENSIONS = /\.(?:jpe?g|png|heic|heif)$/i;
const MIN_SOURCE_BYTES = 1024 * 1024;
const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;
const MAX_OUTPUT_RATIO = 0.9;

function originalResult(file) {
  return {
    file,
    optimized: false,
    originalBytes: Number(file?.size || 0),
    uploadBytes: Number(file?.size || 0),
  };
}

function fittedDimensions(width, height) {
  const longest = Math.max(width, height);
  if (longest <= MAX_DIMENSION) return { width, height };
  const scale = MAX_DIMENSION / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeBrowserPhoto(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Browser could not decode the selected photo'));
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function encodeBrowserWebp({ source, width, height, quality }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Browser image encoder is unavailable');
  context.drawImage(source, 0, 0, width, height);
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('Browser WebP encoding failed')),
        'image/webp',
        quality,
      );
    });
    if (blob.type !== 'image/webp') throw new Error('Browser does not support WebP encoding');
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function webpFileName(name) {
  const source = String(name || 'photo');
  return /\.[^.]+$/.test(source) ? source.replace(/\.[^.]+$/, '.webp') : `${source}.webp`;
}

export async function optimizePhotoForUpload(file, {
  decode = decodeBrowserPhoto,
  encode = encodeBrowserWebp,
} = {}) {
  const type = String(file?.type || '').toLowerCase();
  const hasOptimizableType = OPTIMIZABLE_TYPES.has(type);
  const hasOptimizableExtension = (!type || type === 'application/octet-stream')
    && OPTIMIZABLE_EXTENSIONS.test(String(file?.name || ''));
  if (!file || (!hasOptimizableType && !hasOptimizableExtension)) {
    return originalResult(file);
  }

  let decoded;
  try {
    decoded = await decode(file);
    const width = Number(decoded?.width || 0);
    const height = Number(decoded?.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return originalResult(file);
    }
    if (file.size <= MIN_SOURCE_BYTES && width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
      return originalResult(file);
    }

    const target = fittedDimensions(width, height);
    const blob = await encode({
      source: decoded.source,
      width: target.width,
      height: target.height,
      quality: WEBP_QUALITY,
    });
    if (!blob?.size || blob.size > file.size * MAX_OUTPUT_RATIO) return originalResult(file);

    const optimizedFile = new File([blob], webpFileName(file.name), {
      type: 'image/webp',
      lastModified: file.lastModified || Date.now(),
    });
    return {
      file: optimizedFile,
      optimized: true,
      originalBytes: file.size,
      uploadBytes: optimizedFile.size,
    };
  } catch {
    return originalResult(file);
  } finally {
    decoded?.close?.();
  }
}

export async function preparePhotoUpload({ file, requestId }, dependencies) {
  const optimized = await optimizePhotoForUpload(file, dependencies);
  return { requestId, ...optimized };
}
