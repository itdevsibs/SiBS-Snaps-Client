import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  canRemoveUploadQueueItem,
  canRetryUploadQueueItem,
  deleteUploadQueueItem,
  getUploadQueueItem,
  loadUploadQueue,
  mergeHydratedUploadQueue,
  normalizeUploadQueueItem,
  retryUploadQueueItem,
  saveUploadQueueItem,
  selectNextUploadQueueItem,
  summarizeUploadQueue,
  withUploadQueueLock,
} from './qrWallUploadQueue.js';
import { processUploadQueueItem } from './qrWallUploadQueueProcessor.js';

export function useQrWallUploadQueue({ api, eventToken, onConfirmed }) {
  const [items, setItems] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceWarning, setPersistenceWarning] = useState('');
  const [processorRevision, setProcessorRevision] = useState(0);
  const itemsRef = useRef([]);
  const processingRef = useRef(false);
  const persistenceAvailableRef = useRef(true);
  const generationRef = useRef(0);
  const eventTokenRef = useRef(eventToken);
  const confirmedRef = useRef(onConfirmed);

  useEffect(() => {
    confirmedRef.current = onConfirmed;
  }, [onConfirmed]);

  useLayoutEffect(() => {
    generationRef.current += 1;
    eventTokenRef.current = eventToken;
  }, [eventToken]);

  const replaceItems = useCallback(next => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const persist = useCallback(async item => {
    try {
      await saveUploadQueueItem(item);
      persistenceAvailableRef.current = true;
      return true;
    } catch {
      persistenceAvailableRef.current = false;
      setPersistenceWarning('Uploads will continue while this page is open, but browser storage is unavailable.');
      return false;
    }
  }, []);

  const updateItem = useCallback((requestId, patch) => {
    const current = itemsRef.current;
    const original = current.find(item => item.requestId === requestId);
    if (!original) return Promise.resolve();
    const updated = { ...original, ...patch, updatedAt: Date.now() };
    replaceItems(current.map(item => item.requestId === requestId ? updated : item));
    return persist(updated);
  }, [persist, replaceItems]);

  const updateItemInMemory = useCallback((requestId, patch) => {
    const current = itemsRef.current;
    const original = current.find(item => item.requestId === requestId);
    if (!original) return;
    replaceItems(current.map(item => item.requestId === requestId
      ? { ...original, ...patch, updatedAt: Date.now() }
      : item));
  }, [replaceItems]);

  useEffect(() => {
    const generation = generationRef.current;
    let canceled = false;
    Promise.resolve().then(async () => {
      if (canceled) return;
      replaceItems([]);
      setHydrated(false);
      setPersistenceWarning('');
      if (!eventToken) {
        setHydrated(true);
        return;
      }
      try {
        const stored = await loadUploadQueue(eventToken);
        persistenceAvailableRef.current = true;
        if (!canceled && generationRef.current === generation) {
          replaceItems(mergeHydratedUploadQueue(stored, itemsRef.current, eventToken));
        }
      } catch {
        persistenceAvailableRef.current = false;
        if (!canceled) setPersistenceWarning('Uploads will continue while this page is open, but browser storage is unavailable.');
      } finally {
        if (!canceled && generationRef.current === generation) setHydrated(true);
      }
    });
    return () => { canceled = true; };
  }, [eventToken, replaceItems]);

  const enqueue = useCallback(async ({ requestId, author, caption, file }) => {
    const generation = generationRef.current;
    const queuedEventToken = eventToken;
    const item = {
      requestId,
      eventToken: queuedEventToken,
      author,
      caption,
      file,
      fileName: file?.name || 'Photo',
      status: 'queued',
      progress: 'Queued for upload',
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await persist(item);
    if (generationRef.current !== generation || queuedEventToken !== eventTokenRef.current) return null;
    const current = itemsRef.current;
    replaceItems(current.some(entry => entry.requestId === requestId) ? current : [...current, item]);
    return item;
  }, [eventToken, persist, replaceItems]);

  const remove = useCallback(async requestId => {
    const item = itemsRef.current.find(entry => entry.requestId === requestId);
    if (!item || !canRemoveUploadQueueItem(item)) return false;
    const generation = generationRef.current;
    return withUploadQueueLock(item.eventToken, async () => {
      let authoritative = item;
      if (persistenceAvailableRef.current) {
        try {
          const stored = await getUploadQueueItem(requestId);
          if (!stored) {
            if (generationRef.current === generation) {
              replaceItems(itemsRef.current.filter(entry => entry.requestId !== requestId));
            }
            return true;
          }
          authoritative = stored;
        } catch {
          persistenceAvailableRef.current = false;
          setPersistenceWarning('Browser storage is unavailable. This queued photo was not removed.');
          return false;
        }
      }
      if (!canRemoveUploadQueueItem(authoritative)) {
        if (generationRef.current === generation) {
          updateItemInMemory(requestId, normalizeUploadQueueItem(authoritative));
        }
        return false;
      }
      try {
        await deleteUploadQueueItem(requestId);
      } catch {
        if (persistenceAvailableRef.current) {
          setPersistenceWarning('Browser storage could not remove this queued photo.');
          return false;
        }
      }
      if (generationRef.current === generation) {
        replaceItems(itemsRef.current.filter(entry => entry.requestId !== requestId));
      }
      return true;
    });
  }, [replaceItems, updateItemInMemory]);

  const retry = useCallback(async item => {
    if (!canRetryUploadQueueItem(item)) return false;
    const generation = generationRef.current;
    return withUploadQueueLock(item.eventToken, async () => {
      let authoritative = item;
      if (persistenceAvailableRef.current) {
        try {
          const stored = await getUploadQueueItem(item.requestId);
          if (!stored) {
            if (generationRef.current === generation) {
              replaceItems(itemsRef.current.filter(entry => entry.requestId !== item.requestId));
            }
            return false;
          }
          authoritative = stored;
        } catch {
          persistenceAvailableRef.current = false;
          setPersistenceWarning('Browser storage is unavailable. Retry will continue on this page only.');
        }
      }
      if (!canRetryUploadQueueItem(authoritative)) {
        if (generationRef.current === generation) {
          updateItemInMemory(item.requestId, normalizeUploadQueueItem(authoritative));
        }
        return false;
      }
      const retried = retryUploadQueueItem(authoritative);
      await persist(retried);
      if (generationRef.current === generation) {
        const current = itemsRef.current;
        replaceItems(current.map(entry => entry.requestId === item.requestId ? retried : entry));
      }
      return true;
    });
  }, [persist, replaceItems, updateItemInMemory]);

  useEffect(() => {
    if (!hydrated || !eventToken || processingRef.current) return undefined;
    const nextItem = selectNextUploadQueueItem(items, eventToken);
    if (!nextItem) return undefined;
    const generation = generationRef.current;
    processingRef.current = true;

    void withUploadQueueLock(eventToken, async () => {
      let claimedItem = nextItem;
      if (persistenceAvailableRef.current) {
        try {
          const stored = await getUploadQueueItem(nextItem.requestId);
          if (!stored) {
            replaceItems(itemsRef.current.filter(item => item.requestId !== nextItem.requestId));
            return;
          }
          claimedItem = normalizeUploadQueueItem(stored);
          if (!selectNextUploadQueueItem([claimedItem], eventToken)) {
            updateItemInMemory(nextItem.requestId, claimedItem);
            return;
          }
          updateItemInMemory(nextItem.requestId, claimedItem);
        } catch {
          persistenceAvailableRef.current = false;
          setPersistenceWarning('Uploads will continue while this page is open, but browser storage is unavailable.');
        }
      }

      const result = await processUploadQueueItem(claimedItem, {
        upload: api.upload,
        uploadStatus: api.uploadStatus,
        onProgress: patch => {
          const { persist: shouldPersist = true, ...itemPatch } = patch;
          if (!shouldPersist) {
            updateItemInMemory(claimedItem.requestId, itemPatch);
            return Promise.resolve();
          }
          return updateItem(claimedItem.requestId, itemPatch);
        },
      });
      if (generationRef.current !== generation) return;
      if (result.outcome === 'committed') {
        const remaining = itemsRef.current.filter(item => item.requestId !== claimedItem.requestId);
        replaceItems(remaining);
        await deleteUploadQueueItem(claimedItem.requestId).catch(() => {
          setPersistenceWarning('The upload succeeded, but its local queue record could not be cleared.');
        });
        await confirmedRef.current?.(claimedItem, result);
        return;
      }
      await updateItem(claimedItem.requestId, {
        status: result.outcome,
        progress: result.outcome === 'uncertain' ? 'Confirmation needed' : 'Upload needs attention',
        error: result.error || '',
      });
    }).finally(() => {
      processingRef.current = false;
      setProcessorRevision(value => value + 1);
    });
    return undefined;
  }, [api, eventToken, hydrated, items, processorRevision, replaceItems, updateItem, updateItemInMemory]);

  return {
    items,
    summary: useMemo(() => summarizeUploadQueue(items), [items]),
    persistenceWarning,
    enqueue,
    retry,
    remove,
  };
}
