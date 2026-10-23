const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.7;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function shouldDismissViewerDrag({ offsetY, velocityY }) {
  return Math.abs(finiteNumber(offsetY)) >= DISMISS_DISTANCE
    || Math.abs(finiteNumber(velocityY)) >= DISMISS_VELOCITY;
}

export function getViewerDragPresentation(offsetY, viewportHeight) {
  const distance = Math.abs(finiteNumber(offsetY));
  const height = Math.max(1, finiteNumber(viewportHeight));
  const progress = Math.min(1, distance / Math.max(240, height * 0.45));

  return {
    scale: Math.max(0.92, 1 - progress * 0.08),
    backdropAlpha: Math.max(0.3, 0.88 * (1 - progress * 0.65)),
  };
}

export function getViewerDismissTarget(offsetY, viewportHeight) {
  const direction = finiteNumber(offsetY) < 0 ? -1 : 1;
  return direction * (Math.max(1, finiteNumber(viewportHeight)) + 120);
}

export function getViewerScrollTransfer({ scrollY, offsetY, velocityY, maxScrollY }) {
  const maximum = Math.max(0, finiteNumber(maxScrollY));
  const clamp = value => Math.min(maximum, Math.max(0, value));
  const restoreY = clamp(finiteNumber(scrollY) - finiteNumber(offsetY));
  const momentumTargetY = clamp(restoreY - finiteNumber(velocityY) * 220);

  return { restoreY, momentumTargetY };
}

export function restoreViewerScrollPosition({
  rootStyle,
  bodyStyle,
  originalBodyStyle,
  originalRootScrollBehavior,
  scrollY,
  scrollTo,
}) {
  rootStyle.scrollBehavior = 'auto';
  Object.assign(bodyStyle, originalBodyStyle);
  scrollTo(0, Math.max(0, finiteNumber(scrollY)));
  rootStyle.scrollBehavior = originalRootScrollBehavior;
}
