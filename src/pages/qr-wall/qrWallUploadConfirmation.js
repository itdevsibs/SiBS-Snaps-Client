export const UPLOAD_CONFIRMATION_DURATION_MS = 3000;

export function isConfirmedPhotoUpload(response) {
  const { created } = response || {};
  if (typeof created !== 'number' && typeof created !== 'string') return false;
  return Number(created) === 1;
}
