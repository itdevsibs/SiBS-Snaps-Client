const DB_NAME = 'sibs-snaps-photo-uploads';
const STORE_NAME = 'uploads';
const DB_VERSION = 1;
const ACTIVE_STATUSES = new Set(['optimizing', 'uploading', 'confirming']);
const PROCESSABLE_STATUSES = new Set(['queued', 'needs-check']);

export function normalizeUploadQueueItem(item) {
  const normalized = { ...item, error: String(item?.error || '') };
  if (item?.status === 'optimizing') normalized.status = 'queued';
  if (item?.status === 'uploading' || item?.status === 'confirming') normalized.status = 'needs-check';
  return normalized;
}

export function selectNextUploadQueueItem(items, eventToken) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.eventToken === eventToken && PROCESSABLE_STATUSES.has(item?.status))
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))[0] || null;
}

export function retryUploadQueueItem(item) {
  return {
    ...item,
    status: item?.status === 'uncertain' ? 'needs-check' : 'queued',
    error: '',
    progress: item?.status === 'uncertain' ? 'Checking upload status…' : 'Queued for upload',
  };
}

export function summarizeUploadQueue(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const active = safeItems.find(item => ACTIVE_STATUSES.has(item?.status));
  return {
    total: safeItems.length,
    queued: safeItems.filter(item => item?.status === 'queued' || item?.status === 'needs-check').length,
    failed: safeItems.filter(item => item?.status === 'failed').length,
    uncertain: safeItems.filter(item => item?.status === 'uncertain').length,
    activeRequestId: active?.requestId || null,
    label: active?.progress || (safeItems.length ? 'Waiting to upload' : ''),
  };
}

export function canRemoveUploadQueueItem(item) {
  return ['queued', 'failed', 'uncertain'].includes(item?.status);
}

export function canRetryUploadQueueItem(item) {
  return ['failed', 'uncertain'].includes(item?.status);
}

export function mergeHydratedUploadQueue(storedItems, currentItems, eventToken) {
  const byRequestId = new Map();
  for (const item of Array.isArray(storedItems) ? storedItems : []) {
    const normalized = normalizeUploadQueueItem(item);
    if (normalized?.requestId && (!eventToken || normalized.eventToken === eventToken)) {
      byRequestId.set(normalized.requestId, normalized);
    }
  }
  for (const item of Array.isArray(currentItems) ? currentItems : []) {
    if (item?.requestId && (!eventToken || item.eventToken === eventToken)) {
      byRequestId.set(item.requestId, item);
    }
  }
  return [...byRequestId.values()]
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
}

export function withUploadQueueLock(eventToken, work, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return work();
  return locks.request(
    `sibs-snaps-upload-queue:${eventToken}`,
    { mode: 'exclusive' },
    () => work(),
  );
}

function openQueueDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb?.open) return Promise.reject(new Error('Persistent browser storage is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'requestId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the upload queue'));
  });
}

async function runQueueRequest(mode, execute, indexedDb) {
  const database = await openQueueDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = execute(transaction.objectStore(STORE_NAME));
      let value;
      request.onsuccess = () => { value = request.result; };
      request.onerror = () => reject(request.error || new Error('Upload queue operation failed'));
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || new Error('Upload queue transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Upload queue transaction was canceled'));
    });
  } finally {
    database.close();
  }
}

export async function loadUploadQueue(eventToken, indexedDb) {
  const items = await runQueueRequest('readonly', store => store.getAll(), indexedDb);
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.eventToken === eventToken)
    .map(normalizeUploadQueueItem)
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
}

export function saveUploadQueueItem(item, indexedDb) {
  return runQueueRequest('readwrite', store => store.put(item), indexedDb);
}

export function getUploadQueueItem(requestId, indexedDb) {
  return runQueueRequest('readonly', store => store.get(requestId), indexedDb);
}

export function deleteUploadQueueItem(requestId, indexedDb) {
  return runQueueRequest('readwrite', store => store.delete(requestId), indexedDb);
}
