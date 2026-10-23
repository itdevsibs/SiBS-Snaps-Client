export function resolveRenderedPhoto(photos, visibleId, retainedPhoto) {
  if (!visibleId) return null;
  const livePhoto = photos.find(photo => String(photo.id) === String(visibleId));
  if (livePhoto) return livePhoto;
  return retainedPhoto && String(retainedPhoto.id) === String(visibleId) ? retainedPhoto : null;
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

