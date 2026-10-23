const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.7;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getCreateSheetDragOffset(offsetY) {
  return Math.max(0, finiteNumber(offsetY));
}

export function shouldDismissCreateSheet({ offsetY, velocityY }) {
  return getCreateSheetDragOffset(offsetY) >= DISMISS_DISTANCE
    || finiteNumber(velocityY) >= DISMISS_VELOCITY;
}

export function getCreateSheetBackdropAlpha(offsetY, viewportHeight) {
  const distance = getCreateSheetDragOffset(offsetY);
  const height = Math.max(1, finiteNumber(viewportHeight));
  const progress = Math.min(1, distance / Math.max(240, height * 0.45));
  return Math.max(0.28, 0.72 * (1 - progress * 0.62));
}
