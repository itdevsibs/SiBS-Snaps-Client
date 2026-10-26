const UPLOAD_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PHOTO_UPLOAD_TIMEOUT_MS = 120_000;

export function createUploadRequestId(randomUUID = () => window.crypto.randomUUID()) {
  const requestId = String(randomUUID() || '').trim().toLowerCase();
  if (!UPLOAD_REQUEST_ID.test(requestId)) throw new Error('Browser could not create a secure upload UUID');
  return requestId;
}

export function isUncertainUploadError(error) {
  if (error?.response) return false;
  return ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ERR_CANCELED'].includes(error?.code)
    || /network error|timeout/i.test(String(error?.message || ''));
}

export function uploadProgressLabel({ loaded = 0, total = 0 } = {}) {
  const safeTotal = Number(total);
  const safeLoaded = Number(loaded);
  if (!safeTotal || safeTotal <= 0) return 'Uploading photo…';
  const percent = Math.min(100, Math.max(0, Math.round((safeLoaded / safeTotal) * 100)));
  return percent >= 100 ? 'Processing photo securely…' : `Uploading photo… ${percent}%`;
}

export async function reconcileUploadStatus({
  requestId,
  checkStatus,
  maxChecks = 8,
  wait = () => new Promise(resolve => window.setTimeout(resolve, 2000)),
}) {
  let latest = { state: 'unknown', photoId: null, requestId };
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    try {
      latest = await checkStatus(requestId);
    } catch {
      latest = { state: 'unknown', photoId: null, requestId };
    }
    if (latest?.state === 'committed' || latest?.state === 'failed') return latest;
    if (attempt < maxChecks - 1) await wait();
  }
  return latest;
}

