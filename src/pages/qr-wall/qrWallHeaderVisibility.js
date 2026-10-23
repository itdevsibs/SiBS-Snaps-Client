const TOP_VISIBLE_OFFSET = 8;
const DIRECTION_CHANGE_OFFSET = 8;

export function getHeaderVisibility({ previousY, currentY, visible }) {
  const safeCurrentY = Math.max(0, Number(currentY) || 0);
  const safePreviousY = Math.max(0, Number(previousY) || 0);

  if (safeCurrentY <= TOP_VISIBLE_OFFSET) return true;

  const movement = safeCurrentY - safePreviousY;
  if (movement >= DIRECTION_CHANGE_OFFSET) return false;
  if (movement <= -DIRECTION_CHANGE_OFFSET) return true;

  return visible;
}

export function isMeaningfulHeaderScroll(previousY, currentY) {
  const safeCurrentY = Math.max(0, Number(currentY) || 0);
  const safePreviousY = Math.max(0, Number(previousY) || 0);
  return safeCurrentY <= TOP_VISIBLE_OFFSET
    || Math.abs(safeCurrentY - safePreviousY) >= DIRECTION_CHANGE_OFFSET;
}

export function getHeaderPresentationClass({ visible, modalOpen }) {
  const visibilityClass = visible ? 'is-visible' : 'is-hidden';
  return modalOpen ? `${visibilityClass} is-suspended` : visibilityClass;
}
