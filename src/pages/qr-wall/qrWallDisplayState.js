export function resolveRenderedPhoto(photos, visibleId, retainedPhoto) {
  if (!visibleId) return null;
  const livePhoto = photos.find(photo => String(photo.id) === String(visibleId));
  if (livePhoto) return livePhoto;
  return retainedPhoto && String(retainedPhoto.id) === String(visibleId) ? retainedPhoto : null;
}

export const DISPLAY_IMAGE_TIMEOUT_MS = 5500;

export function getDisplayImageCandidates(photo, fallbackUrl = '') {
  const candidates = [photo?.images?.feed, photo?.images?.large, photo?.imageUrl, fallbackUrl]
    .filter(url => typeof url === 'string' && url.length > 0);
  return [...new Set(candidates)];
}

export async function fetchDisplayImageBlob(candidates, {
  fetchImpl = fetch,
  timeoutMs = DISPLAY_IMAGE_TIMEOUT_MS,
  signal,
} = {}) {
  const urls = [...new Set((Array.isArray(candidates) ? candidates : []).filter(Boolean))];
  if (!urls.length) throw new Error('No display image URL is available');

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let lastError = null;
  try {
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, { cache: 'force-cache', signal: controller.signal });
        const contentType = response.headers?.get?.('content-type')?.toLowerCase() || '';
        if (!response.ok || !contentType.startsWith('image/')) {
          lastError = new Error(`Photo endpoint unavailable (HTTP ${response.status})`);
          continue;
        }
        const blob = await response.blob();
        if (!blob.size) {
          lastError = new Error('Photo returned no image bytes');
          continue;
        }
        return { blob, url };
      } catch (error) {
        if (controller.signal.aborted) {
          if (timedOut) {
            throw new Error(`Photo download timed out after ${timeoutMs}ms`, { cause: error });
          }
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError || new Error('Photo could not be downloaded');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function getAnimatedHeartCount(rawCount, variant = 'feed') {
  const maximum = variant === 'display' ? 10 : 120;
  return Math.min(maximum, Math.max(0, Math.trunc(Number(rawCount) || 0)));
}

export function getDisplayHeartX(noiseValue) {
  const normalized = Math.min(1, Math.max(0, Number(noiseValue) || 0));
  return 42 + normalized * 16;
}

export function hasReactionIncrease(previousCount, currentCount) {
  if (previousCount === undefined || previousCount === null) return false;
  return Number(currentCount || 0) > Number(previousCount || 0);
}

export function applyReactionChange(photos, change) {
  if (!['reaction-added', 'reaction-removed'].includes(change?.type)
    || change?.photoId === undefined
    || !Number.isFinite(Number(change?.reactionCount))) return photos;
  const photoId = String(change.photoId);
  const reactionCount = Math.max(0, Math.trunc(Number(change.reactionCount)));
  let matched = false;
  const updated = photos.map(photo => {
    if (String(photo.id) !== photoId) return photo;
    matched = true;
    return { ...photo, reactionCount };
  });
  return matched ? updated : photos;
}

export function shouldPlayCelebratePop(response) {
  return Boolean(response?.reacted && !response?.alreadyReacted);
}

export function isDoubleTapGesture(lastTime, currentTime, maxDelay = 320) {
  if (!lastTime || !currentTime) return false;
  const diff = currentTime - lastTime;
  return diff > 0 && diff <= maxDelay;
}

export function canTriggerReaction({ onReact, reacting = false, closed = false }) {
  return Boolean(onReact && !reacting && !closed);
}

export function calculateOptimisticReaction(photo) {
  const isCurrentlyReacted = Boolean(photo?.reacted);
  const currentCount = Number(photo?.reactionCount || 0);
  return {
    reacted: !isCurrentlyReacted,
    reactionCount: Math.max(0, currentCount + (isCurrentlyReacted ? -1 : 1)),
  };
}

export function getDoubleTapHeartTone(photo) {
  return photo?.reacted ? 'unreact-hollow' : 'react-fill';
}

export function shouldShowDoubleTapBurst(photo) {
  return !photo?.reacted;
}

