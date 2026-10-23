/**
 * State helpers and utilities for the Instagram-style SiBS-Snaps photo wall feed.
 * Zero-dependency, testable logic for infinite scroll, deduplication, responsive
 * image resolution, and live SSE/polling updates.
 */

/**
 * Normalizes backend responses for photo wall feeds.
 * Supports backend envelope:
 * {
 *   event?: { ... },
 *   photos: [ ... ],
 *   pagination: { nextCursor: string | null, hasMore: boolean }
 * }
 * As well as legacy/top-level envelopes:
 * { photos: [...], nextCursor, hasMore }
 * { data: [...], pagination: { ... } }
 */
export function parsePhotosResponse(response) {
  if (!response || typeof response !== 'object') {
    return { event: null, photos: [], nextCursor: null, hasMore: false };
  }

  const rawPhotos = Array.isArray(response)
    ? response
    : (response.photos || response.data || response.items || []);
  const photos = Array.isArray(rawPhotos) ? rawPhotos : [];

  let nextCursor;
  let hasMore;

  if (response.pagination && typeof response.pagination === 'object') {
    nextCursor = response.pagination.nextCursor ?? null;
    hasMore = Boolean(response.pagination.hasMore);
  } else {
    nextCursor = response.nextCursor ?? null;
    hasMore = response.hasMore !== undefined
      ? Boolean(response.hasMore)
      : Boolean(nextCursor);
  }

  return {
    event: response.event || null,
    photos,
    nextCursor,
    hasMore: Boolean(hasMore && nextCursor),
  };
}

/**
 * Merges a newly fetched page of older photos onto existing feed items.
 * Deduplicates by post ID, preserving original post instances where possible.
 */
export function appendFeedPhotos(existing = [], incoming = []) {
  const safeExisting = Array.isArray(existing) ? existing : [];
  const safeIncoming = Array.isArray(incoming) ? incoming : [];
  if (!safeIncoming.length) return safeExisting;
  if (!safeExisting.length) return safeIncoming;

  const existingIds = new Set(safeExisting.map(p => String(p.id)));
  const uniqueIncoming = safeIncoming.filter(p => !existingIds.has(String(p.id)));

  if (!uniqueIncoming.length) return safeExisting;
  return [...safeExisting, ...uniqueIncoming];
}

/**
 * Inserts newly uploaded or refreshed posts at the top of the feed.
 * Deduplicates by post ID and updates reaction counts or metadata on existing posts.
 */
export function prependFeedPhotos(existing = [], incoming = []) {
  const safeExisting = Array.isArray(existing) ? existing : [];
  const safeIncoming = Array.isArray(incoming) ? incoming : [];
  if (!safeIncoming.length) return safeExisting;
  if (!safeExisting.length) return safeIncoming;

  const incomingMap = new Map(safeIncoming.map(p => [String(p.id), p]));
  const existingIds = new Set(safeExisting.map(p => String(p.id)));

  const trulyNew = safeIncoming.filter(p => !existingIds.has(String(p.id)));

  // If existing photos are present in incoming, merge their latest metadata
  const updatedExisting = safeExisting.map(item => {
    const fresh = incomingMap.get(String(item.id));
    if (!fresh) return item;
    if (
      fresh.reactionCount === item.reactionCount &&
      fresh.reacted === item.reacted &&
      fresh.caption === item.caption
    ) {
      return item;
    }
    return { ...item, ...fresh };
  });

  if (!trulyNew.length) return updatedExisting;
  return [...trulyNew, ...updatedExisting];
}

/**
 * Detects whether a photo is an animated GIF.
 */
export function isAnimatedGif(photo, src = '') {
  if (photo?.isGif || photo?.mimeType === 'image/gif') return true;
  const target = src || photo?.images?.feed || photo?.images?.large || photo?.imageUrl || '';
  return /\.gif($|\?)/i.test(target);
}

/**
 * Resolves image variant URLs and attributes with full backward compatibility.
 * - Main feed uses images.feed
 * - Thumbnails use images.thumbnail
 * - Fullscreen viewer uses images.large
 * - Fallbacks to photo.imageUrl or provided fallbackUrl
 * - Animated GIFs omit static srcSet to ensure continuous playback
 */
export function resolveImageVariants(photo, fallbackUrl = '') {
  if (!photo) {
    return {
      feedSrc: fallbackUrl,
      thumbSrc: '',
      largeSrc: fallbackUrl,
      srcSet: undefined,
      sizes: undefined,
      aspectRatio: undefined,
      isGif: false,
    };
  }

  const images = photo.images;
  const feedSrc = images?.feed || photo.imageUrl || fallbackUrl || '';
  const thumbSrc = images?.thumbnail || '';
  const largeSrc = images?.large || feedSrc;

  const isGif = isAnimatedGif(photo, feedSrc);

  let aspectRatio = undefined;
  if (images?.width && images?.height && images.width > 0 && images.height > 0) {
    aspectRatio = `${images.width} / ${images.height}`;
  }

  // Build responsive srcSet only when distinct variants exist and it's not a GIF
  let srcSet = undefined;
  let sizes = undefined;
  if (!isGif && images?.feed && images?.large && images.feed !== images.large) {
    srcSet = `${images.feed} 720w, ${images.large} 1440w`;
    sizes = '(max-width: 640px) 100vw, 520px';
  }

  return {
    feedSrc,
    thumbSrc,
    largeSrc,
    srcSet,
    sizes,
    aspectRatio,
    isGif,
  };
}

/**
 * Prefetches the next N images ahead in the feed.
 */
export function prefetchImages(urls) {
  if (typeof window === 'undefined' || !Array.isArray(urls)) return;
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;
    const img = new Image();
    img.src = url;
  }
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // Exactly 10 MiB per individual file

/**
 * Validates a photo post submission payload before sending to backend.
 */
export function validatePhotoSubmission({ name, files, maxBytes = MAX_PHOTO_BYTES }) {
  if (!name || !name.trim()) {
    return { valid: false, error: 'Please enter your name.' };
  }
  if (!files || files.length !== 1) {
    return { valid: false, error: 'Choose exactly one photo per submission.' };
  }
  const file = files[0];
  if (file.size > maxBytes) {
    return { valid: false, error: `"${file.name || 'This photo'}" exceeds the 10 MB limit.` };
  }
  if (file.size === 0) {
    return { valid: false, error: 'The selected photo is empty.' };
  }
  return { valid: true, error: null };
}

