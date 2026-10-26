import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowUp, Camera, CheckCircle2, ImagePlus, LoaderCircle, RotateCcw, Send, Trash2, UserRound, X } from 'lucide-react';
import PhotoPost from '../../components/qr-wall/PhotoPost';
import { readableQrWallError, readableUploadError } from '../../lib/axios/qrWallApi';
import { applyReactionChange } from './qrWallDisplayState';
import {
  MAX_PHOTO_BYTES,
  appendFeedPhotos,
  isGifUpload,
  parsePhotosResponse,
  prefetchImages,
  prependFeedPhotos,
  validatePhotoSubmission,
} from './qrWallFeedState';
import { splitCaption } from '../../components/qr-wall/captionText';
import { getHeaderPresentationClass, getHeaderVisibility, isMeaningfulHeaderScroll } from './qrWallHeaderVisibility';
import {
  getViewerDismissTarget,
  getViewerDragPresentation,
  getViewerScrollTransfer,
  restoreViewerScrollPosition,
  shouldDismissViewerDrag,
} from './qrWallViewerDrag';
import {
  getCreateSheetBackdropAlpha,
  getCreateSheetDragOffset,
  shouldDismissCreateSheet,
} from './qrWallCreateSheetDrag';
import {
  UPLOAD_CONFIRMATION_DURATION_MS,
} from './qrWallUploadConfirmation';
import { createUploadRequestId } from './qrWallUploadReliability';
import { useQrWallUploadQueue } from './useQrWallUploadQueue';
import './qrWall.css';

const PAGE_SIZE = 10;

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

export default function QRWallJoinPage({ api, token }) {
  const { token: routeToken } = useParams();
  const urlToken = window.location.pathname.match(/\/photo-wall\/join\/([0-9a-f]{48})(?:\/|$)/i)?.[1];
  const wallToken = [token, routeToken, urlToken]
    .find(value => typeof value === 'string' && /^[0-9a-f]{48}$/i.test(value)) || null;

  const [event, setEvent] = useState(null);
  const moderationRef = useRef(null);
  const wallTokenRef = useRef(wallToken);
  useEffect(() => { wallTokenRef.current = wallToken; }, [wallToken]);

  const [prevWallToken, setPrevWallToken] = useState(wallToken);
  const [photos, setPhotos] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(wallToken));
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const [newPostsQueue, setNewPostsQueue] = useState([]);
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const isScrolledDownRef = useRef(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const headerScrollYRef = useRef(window.scrollY);

  const [name, setName] = useState(() => sessionStorage.getItem('qr-wall-guest-name') || '');
  const [files, setFiles] = useState([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [completedUploadNoticeToken, setCompletedUploadNoticeToken] = useState(null);
  const [reactBusyIds, setReactBusyIds] = useState(() => new Set());
  const [error, setError] = useState(() => wallToken ? '' : 'Invalid photo wall link. Scan the QR code on the display again.');
  const [viewerPhoto, setViewerPhoto] = useState(null);
  const [viewerDragY, setViewerDragY] = useState(0);
  const [viewerDragging, setViewerDragging] = useState(false);
  const [viewerDismissing, setViewerDismissing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadConfirmation, setShowUploadConfirmation] = useState(false);
  const [modalError, setModalError] = useState('');
  const [createSheetDragY, setCreateSheetDragY] = useState(0);
  const [createSheetDragging, setCreateSheetDragging] = useState(false);
  const [createSheetDismissing, setCreateSheetDismissing] = useState(false);

  const lastActiveElementRef = useRef(null);
  const nameInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const viewerDismissTimerRef = useRef(null);
  const viewerMomentumFrameRef = useRef(null);
  const viewerScrollTransferRef = useRef({ offsetY: 0, velocityY: 0 });
  const viewerGestureRef = useRef({ pointerId: null, startY: 0, lastY: 0, lastTime: 0, offsetY: 0, velocityY: 0 });
  const createSheetGestureRef = useRef({ pointerId: null, startY: 0, lastY: 0, lastTime: 0, offsetY: 0, velocityY: 0 });
  const createSheetDismissTimerRef = useRef(null);
  const uploadConfirmationTimerRef = useRef(null);
  const uploadConfirmationDialogRef = useRef(null);
  const modalOpenRef = useRef(false);

  useEffect(() => {
    modalOpenRef.current = Boolean(viewerPhoto || showCreateModal || showUploadConfirmation);
  }, [viewerPhoto, showCreateModal, showUploadConfirmation]);

  const resetViewerMotion = useCallback(() => {
    setViewerDragY(0);
    setViewerDragging(false);
    setViewerDismissing(false);
    viewerGestureRef.current.pointerId = null;
  }, []);

  const closeViewer = useCallback(() => {
    if (viewerDismissTimerRef.current) {
      window.clearTimeout(viewerDismissTimerRef.current);
      viewerDismissTimerRef.current = null;
    }
    setViewerPhoto(null);
    resetViewerMotion();
  }, [resetViewerMotion]);

  const openViewer = useCallback(photo => {
    if (viewerMomentumFrameRef.current) {
      window.cancelAnimationFrame(viewerMomentumFrameRef.current);
      viewerMomentumFrameRef.current = null;
    }
    viewerScrollTransferRef.current = { offsetY: 0, velocityY: 0 };
    resetViewerMotion();
    setViewerPhoto(photo);
  }, [resetViewerMotion]);

  if (prevWallToken !== wallToken) {
    setPrevWallToken(wallToken);
    setPhotos([]);
    setCursor(null);
    setHasMore(false);
    setNewPostsQueue([]);
    setViewerPhoto(null);
    setShowCreateModal(false);
    setShowUploadConfirmation(false);
    setCompletedUploadNoticeToken(null);
    setLoading(Boolean(wallToken));
    setError(wallToken ? '' : 'Invalid photo wall link. Scan the QR code on the display again.');
  }

  const sentinelRef = useRef(null);
  const abortControllerRef = useRef(null);

  const previews = useMemo(() => files.slice(0, 1).map(file => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);

  // Track feed position and show or hide the sticky mobile header by scroll direction.
  useEffect(() => {
    const handleScroll = () => {
      const currentY = Math.max(0, window.scrollY);
      const scrolled = currentY > 220;
      isScrolledDownRef.current = scrolled;
      setIsScrolledDown(scrolled);

      if (modalOpenRef.current) {
        headerScrollYRef.current = currentY;
        return;
      }

      setIsHeaderVisible(visible => getHeaderVisibility({
        previousY: headerScrollYRef.current,
        currentY,
        visible,
      }));

      if (isMeaningfulHeaderScroll(headerScrollYRef.current, currentY)) {
        headerScrollYRef.current = currentY;
      }
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Escape key closes fullscreen lightbox viewer
  useEffect(() => {
    if (!viewerPhoto) return undefined;
    const handleKeyDown = e => {
      if (e.key === 'Escape') closeViewer();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerPhoto, closeViewer]);

  // Freeze the feed at its exact position while the full-photo viewer is open.
  useLayoutEffect(() => {
    if (!viewerPhoto) return undefined;

    const body = document.body;
    const rootStyle = document.documentElement.style;
    const scrollY = window.scrollY;
    const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const originalRootScrollBehavior = rootStyle.scrollBehavior;
    const original = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };
    const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    if (scrollbarGap) body.style.paddingRight = `${scrollbarGap}px`;

    return () => {
      const transfer = getViewerScrollTransfer({
        scrollY,
        ...viewerScrollTransferRef.current,
        maxScrollY,
      });
      viewerScrollTransferRef.current = { offsetY: 0, velocityY: 0 };
      restoreViewerScrollPosition({
        rootStyle,
        bodyStyle: body.style,
        originalBodyStyle: original,
        originalRootScrollBehavior,
        scrollY: transfer.restoreY,
        scrollTo: (x, y) => window.scrollTo(x, y),
      });
      if (Math.abs(transfer.momentumTargetY - transfer.restoreY) > 1) {
        viewerMomentumFrameRef.current = window.requestAnimationFrame(() => {
          window.scrollTo({ top: transfer.momentumTargetY, left: 0, behavior: 'smooth' });
          viewerMomentumFrameRef.current = null;
        });
      }
    };
  }, [viewerPhoto]);

  useEffect(() => () => {
    if (viewerDismissTimerRef.current) window.clearTimeout(viewerDismissTimerRef.current);
    if (viewerMomentumFrameRef.current) window.cancelAnimationFrame(viewerMomentumFrameRef.current);
  }, []);

  // Prefetch the next 1-2 images when feed updates
  useEffect(() => {
    if (photos.length > 1) {
      prefetchImages([
        photos[1]?.images?.feed,
        photos[2]?.images?.feed,
      ]);
    }
  }, [photos]);

  // Refresh the latest 10 items without loading entire history
  const refreshFirstPage = useCallback(async () => {
    const currentToken = wallTokenRef.current;
    if (!currentToken) return;

    try {
      const response = await api.getPhotos(currentToken, null, PAGE_SIZE);
      if (wallTokenRef.current !== currentToken) return;

      const parsed = parsePhotosResponse(response);
      if (parsed.event) setEvent(parsed.event);

      const revision = parsed.event?.moderationRevision;
      const moderationChanged = revision !== undefined && moderationRef.current !== null && revision !== moderationRef.current;
      if (revision !== undefined) moderationRef.current = revision;

      if (moderationChanged) {
        setPhotos(parsed.photos);
        setCursor(parsed.nextCursor);
        setHasMore(parsed.hasMore);
        return;
      }

      setPhotos(currentPhotos => {
        const knownIds = new Set(currentPhotos.map(p => String(p.id)));
        const trulyNew = parsed.photos.filter(p => !knownIds.has(String(p.id)));

        if (!trulyNew.length) {
          return prependFeedPhotos(currentPhotos, parsed.photos);
        }

        if (isScrolledDownRef.current) {
          setNewPostsQueue(q => {
            const queueIds = new Set(q.map(p => String(p.id)));
            const itemsForQueue = trulyNew.filter(p => !queueIds.has(String(p.id)));
            return [...itemsForQueue, ...q];
          });
          return prependFeedPhotos(currentPhotos, parsed.photos.filter(p => knownIds.has(String(p.id))));
        }

        return prependFeedPhotos(currentPhotos, parsed.photos);
      });
      setError('');
    } catch {
      // Background sync errors do not blank out rendered feed
    }
  }, [api]);

  // Load next page of older photos
  const loadNextPage = useCallback(async () => {
    const currentToken = wallTokenRef.current;
    if (!currentToken || !cursor || !hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const response = await api.getPhotos(currentToken, cursor, PAGE_SIZE);
      if (wallTokenRef.current !== currentToken) return;

      const parsed = parsePhotosResponse(response);
      setPhotos(prev => appendFeedPhotos(prev, parsed.photos));
      setCursor(parsed.nextCursor);
      setHasMore(parsed.hasMore);
    } catch (err) {
      setError(readableQrWallError(err, 'Could not load older photos.'));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [api, cursor, hasMore]);

  // Infinite scroll intersection observer
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || !cursor || loadingMore) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadNextPage();
      }
    }, { rootMargin: '350px' });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, cursor, loadingMore, loadNextPage]);

  // Initial data hydration on mount or when event token changes
  useEffect(() => {
    if (!wallToken) {
      return undefined;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Progressive rendering: load event details and first 10 posts independently
    api.getEvent(wallToken, { signal: controller.signal })
      .then(detail => {
        if (wallTokenRef.current === wallToken && detail?.event) {
          setEvent(detail.event);
        }
      })
      .catch(() => {});

    api.getPhotos(wallToken, null, PAGE_SIZE, { signal: controller.signal })
      .then(response => {
        if (wallTokenRef.current !== wallToken) return;
        const parsed = parsePhotosResponse(response);
        if (parsed.event) setEvent(parsed.event);
        moderationRef.current = parsed.event?.moderationRevision ?? null;
        setPhotos(parsed.photos);
        setCursor(parsed.nextCursor);
        setHasMore(parsed.hasMore);
      })
      .catch(err => {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        if (wallTokenRef.current === wallToken) {
          setError(readableQrWallError(err, 'Photo wall is unavailable'));
        }
      })
      .finally(() => {
        if (wallTokenRef.current === wallToken) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [api, wallToken]);

  // Live event updates via SSE + lightweight visible-tab sync
  useEffect(() => {
    if (!wallToken) return undefined;

    let stream = null;
    try {
      stream = new EventSource(api.streamUrl(wallToken));
    } catch {
      stream = null;
    }

    const handleEventData = (rawData) => {
      try {
        const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        if (
          data?.type === 'reaction-added' ||
          data?.type === 'reaction-removed' ||
          (data?.photoId !== undefined && data?.reactionCount !== undefined)
        ) {
          setPhotos(prev => applyReactionChange(prev, data));
          return;
        }

        const newPhoto = data?.photo || data?.post;
        if (newPhoto && newPhoto.id) {
          setPhotos(prev => {
            if (prev.some(p => String(p.id) === String(newPhoto.id))) return prev;
            if (isScrolledDownRef.current) {
              setNewPostsQueue(q => (q.some(p => String(p.id) === String(newPhoto.id)) ? q : [newPhoto, ...q]));
              return prev;
            }
            return [newPhoto, ...prev];
          });
          return;
        }
      } catch {
        // Fallback to refreshFirstPage
      }
      void refreshFirstPage();
    };

    const onLiveEvent = (eventMessage) => {
      handleEventData(eventMessage?.data);
    };

    if (stream) {
      stream.addEventListener('change', onLiveEvent);
      stream.addEventListener('message', onLiveEvent);
      stream.addEventListener('photo', onLiveEvent);
      stream.addEventListener('photo-published', onLiveEvent);
      stream.addEventListener('photo-approved', onLiveEvent);
      stream.addEventListener('reaction', onLiveEvent);
    }

    const pollInterval = 10000;
    let pollTimer = null;
    const schedulePoll = () => {
      pollTimer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          await refreshFirstPage();
        }
        schedulePoll();
      }, pollInterval);
    };
    schedulePoll();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshFirstPage();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (stream) stream.close();
      window.clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [api, wallToken, refreshFirstPage]);

  const clearAlerts = () => { setError(''); };

  const resetCreateSheetMotion = useCallback(() => {
    setCreateSheetDragY(0);
    setCreateSheetDragging(false);
    setCreateSheetDismissing(false);
    createSheetGestureRef.current.pointerId = null;
  }, []);

  const clearUploadConfirmationTimer = useCallback(() => {
    if (uploadConfirmationTimerRef.current) {
      window.clearTimeout(uploadConfirmationTimerRef.current);
      uploadConfirmationTimerRef.current = null;
    }
  }, []);

  const dismissUploadConfirmation = useCallback((restoreFocus = true) => {
    clearUploadConfirmationTimer();
    setShowUploadConfirmation(false);
    if (restoreFocus && lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === 'function') {
      window.requestAnimationFrame(() => lastActiveElementRef.current?.focus());
    }
  }, [clearUploadConfirmationTimer]);

  const openUploadConfirmation = useCallback(() => {
    clearUploadConfirmationTimer();
    setShowUploadConfirmation(true);
    uploadConfirmationTimerRef.current = window.setTimeout(
      () => dismissUploadConfirmation(),
      UPLOAD_CONFIRMATION_DURATION_MS,
    );
  }, [clearUploadConfirmationTimer, dismissUploadConfirmation]);

  const handleQueuedUploadConfirmed = useCallback(async item => {
    setCompletedUploadNoticeToken(item.eventToken);
    await refreshFirstPage().catch(() => {});
  }, [refreshFirstPage]);

  const uploadQueue = useQrWallUploadQueue({
    api,
    eventToken: wallToken,
    onConfirmed: handleQueuedUploadConfirmed,
  });

  useEffect(() => {
    if (completedUploadNoticeToken !== wallToken || showCreateModal || showUploadConfirmation) return;
    const timer = window.setTimeout(() => {
      setCompletedUploadNoticeToken(null);
      openUploadConfirmation();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [completedUploadNoticeToken, openUploadConfirmation, showCreateModal, showUploadConfirmation, wallToken]);

  const openCreateModal = useCallback((autoTriggerFile = false) => {
    dismissUploadConfirmation(false);
    lastActiveElementRef.current = document.activeElement;
    setModalError('');
    resetCreateSheetMotion();
    setShowCreateModal(true);
    if (autoTriggerFile && files.length === 0) {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 60);
    }
  }, [dismissUploadConfirmation, files.length, resetCreateSheetMotion]);

  const closeCreateModal = useCallback(() => {
    if (busy) return;
    if (createSheetDismissTimerRef.current) {
      window.clearTimeout(createSheetDismissTimerRef.current);
      createSheetDismissTimerRef.current = null;
    }
    setShowCreateModal(false);
    setModalError('');
    resetCreateSheetMotion();
    if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === 'function') {
      lastActiveElementRef.current.focus();
    }
  }, [busy, resetCreateSheetMotion]);

  useEffect(() => () => {
    if (createSheetDismissTimerRef.current) {
      window.clearTimeout(createSheetDismissTimerRef.current);
    }
  }, []);

  useEffect(() => () => clearUploadConfirmationTimer(), [clearUploadConfirmationTimer]);

  useEffect(() => {
    clearUploadConfirmationTimer();
  }, [wallToken, clearUploadConfirmationTimer]);

  useEffect(() => {
    if (!showUploadConfirmation) return undefined;
    const focusFrame = window.requestAnimationFrame(() => uploadConfirmationDialogRef.current?.focus());
    const handleKeyDown = eventData => {
      if (eventData.key === 'Escape') dismissUploadConfirmation();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showUploadConfirmation, dismissUploadConfirmation]);

  // Escape key closes modal
  useEffect(() => {
    if (!showCreateModal) return undefined;
    const handleKeyDown = e => {
      if (e.key === 'Escape' && !busy) {
        closeCreateModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal, busy, closeCreateModal]);

  const createFlowModalOpen = showCreateModal || showUploadConfirmation;

  // Keep the feed locked across the Create Post to confirmation handoff.
  useEffect(() => {
    if (!createFlowModalOpen) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [createFlowModalOpen]);

  // Auto-focus name field if empty when modal opens
  useEffect(() => {
    if (showCreateModal) {
      const timer = setTimeout(() => {
        if (!name.trim() && nameInputRef.current) {
          nameInputRef.current.focus();
        }
      }, 60);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [showCreateModal, name]);

  const handleFileSelect = e => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    if (selected.length > 1) {
      setModalError('Choose only one photo per submission.');
    } else if (selected[0]?.size > MAX_PHOTO_BYTES) {
      setModalError(`"${selected[0].name}" exceeds the 10 MB limit.`);
    } else if (selected[0]?.size === 0) {
      setModalError('The selected photo is empty.');
    } else if (isGifUpload(selected[0])) {
      setModalError('GIF images are not supported. Choose a JPG, PNG, WebP, AVIF, HEIC, or HEIF photo.');
    } else {
      setFiles(selected);
      setModalError('');
    }
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onUpload = async eventData => {
    if (eventData) eventData.preventDefault();
    if (busy) return;
    setModalError('');
    clearAlerts();

    if (!wallToken) {
      setModalError('The upload link is invalid. Scan the QR code again.');
      return;
    }

    const validation = validatePhotoSubmission({ name, files, caption, maxBytes: MAX_PHOTO_BYTES });
    if (!validation.valid) {
      setModalError(validation.error);
      return;
    }

    setBusy(true);
    try {
      const requestId = createUploadRequestId();
      sessionStorage.setItem('qr-wall-guest-name', name.trim());
      const queued = await uploadQueue.enqueue({
        requestId,
        author: name.trim(),
        caption,
        file: files[0],
      });
      if (!queued) return;
      setFiles([]);
      setCaption('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      resetCreateSheetMotion();
      setShowCreateModal(false);
    } catch (err) {
      const readable = readableQrWallError(err, 'Could not add this photo to the upload queue. Please try again.');
      setModalError(readable);
      setError(readable);
    } finally {
      setBusy(false);
    }
  };

  const onReact = async photo => {
    const id = String(photo.id);
    if (closed || reactBusyIds.has(id)) return null;
    setReactBusyIds(previous => new Set(previous).add(id));
    try {
      const response = photo.reacted
        ? await api.unreact(wallToken, id)
        : await api.react(wallToken, id);
      setPhotos(previous => previous.map(item => String(item.id) === id
        ? { ...item, reacted: Boolean(response.reacted), reactionCount: Number(response.reactionCount || 0) }
        : item));
      return response;
    } catch (err) {
      setError(readableQrWallError(err, 'Could not update reaction. Please try again.'));
      return null;
    } finally {
      setReactBusyIds(previous => {
        const updated = new Set(previous);
        updated.delete(id);
        return updated;
      });
    }
  };

  const applyQueuedNewPhotos = () => {
    setPhotos(prev => prependFeedPhotos(prev, newPostsQueue));
    setNewPostsQueue([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closed = event?.status !== 'active';
  const modalOpen = Boolean(viewerPhoto || showCreateModal || showUploadConfirmation);

  return (
    <main className="qrw qrw-mobile">
      <header
        className={`qrw-mobile-head ${getHeaderPresentationClass({ visible: isHeaderVisible, modalOpen })}`}
        aria-hidden={modalOpen || undefined}
      >
        <span className="qrw-mobile-brand">
          <img className="qrw-mobile-logo" src="/SiBSLogoWhite.png"
            alt="SiBS — Human Expertise. Technology Forward." />
        </span>
        <span className="qrw-mobile-live"><span className="qrw-status-light" /> LIVE WALL</span>
      </header>
      <div className="qrw-mobile-main">
        <div className="qrw-mobile-hero"><span className="qrw-mobile-overline">CAPTURE · SHARE · CELEBRATE</span>
          <h1>{event?.title || (loading ? 'Loading moments…' : 'Photo wall')}</h1>
          <p>Every photo has a story. Add yours to the moment.</p></div>
        {error ? <div className="qrw-alert qrw-alert-error" role="alert">{error}</div> : null}
        {!loading && !event ? <div className="qrw-alert qrw-alert-error">This QR link is invalid or unavailable.</div> : null}
        {event ? <>
          {closed ? <div className="qrw-alert">This event has ended. You can still browse the photos.</div> : null}
          {uploadQueue.items.length || uploadQueue.persistenceWarning ? (
            <section className="qrw-upload-queue" aria-live="polite" aria-label="Photo upload queue">
              <div className="qrw-upload-queue-head">
                <span className="qrw-upload-queue-title">
                  {uploadQueue.summary.activeRequestId ? <LoaderCircle size={16} className="qrw-upload-queue-spinner" /> : null}
                  <strong>{uploadQueue.summary.label || `${uploadQueue.summary.total} pending upload${uploadQueue.summary.total === 1 ? '' : 's'}`}</strong>
                </span>
                {uploadQueue.summary.queued ? <small>{uploadQueue.summary.queued} queued</small> : null}
              </div>
              {uploadQueue.persistenceWarning ? <p className="qrw-upload-queue-warning">{uploadQueue.persistenceWarning}</p> : null}
              {uploadQueue.items.map(item => (
                <div className={`qrw-upload-queue-item qrw-upload-queue-item--${item.status}`} key={item.requestId}>
                  <span>
                    <strong>{item.fileName}</strong>
                    <small>{item.error || item.progress || 'Queued for upload'}</small>
                  </span>
                  <span className="qrw-upload-queue-actions">
                    {['failed', 'uncertain'].includes(item.status) ? (
                      <button type="button" onClick={() => uploadQueue.retry(item)}>
                        <RotateCcw size={14} /> {item.status === 'uncertain' ? 'Check status' : 'Retry'}
                      </button>
                    ) : null}
                    {['queued', 'failed', 'uncertain'].includes(item.status) ? (
                      <button type="button" onClick={() => uploadQueue.remove(item.requestId)} aria-label={`Remove ${item.fileName} from queue`}>
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          {!closed ? (
            <div className="qrw-composer-card">
              <div className="qrw-composer-top">
                <button
                  type="button"
                  className={`qrw-avatar qrw-composer-avatar ${!name.trim() ? 'qrw-avatar--anon' : ''}`}
                  onClick={() => openCreateModal(false)}
                  aria-label="Create a post"
                >
                  {name.trim() ? (
                    name.trim().charAt(0).toUpperCase()
                  ) : (
                    <UserRound size={20} strokeWidth={2.2} className="qrw-avatar-icon" />
                  )}
                </button>
                <button
                  type="button"
                  className="qrw-composer-trigger"
                  onClick={() => openCreateModal(false)}
                  aria-label="Upload your moments here"
                >
                  <span>Upload your moments here</span>
                </button>
              </div>
            </div>
          ) : null}

          <div className="qrw-mobile-feed">
            {newPostsQueue.length > 0 && isScrolledDown ? (
              <button
                type="button"
                className="qrw-new-photos-indicator"
                onClick={applyQueuedNewPhotos}
                aria-label={`${newPostsQueue.length} new moments available. Tap to scroll to top.`}
              >
                <ArrowUp size={15} />
                <span>{newPostsQueue.length} new {newPostsQueue.length === 1 ? 'moment' : 'moments'}</span>
              </button>
            ) : null}

            {loading ? <p>Loading moments…</p> : null}
            {!photos.length && !loading ? <div className="qrw-mobile-empty"><Camera size={35} /><p>No photos yet. Be the first!</p></div> : null}

            {photos.map((photo, index) => (
              <div key={photo.id}>
                <PhotoPost
                  photo={photo}
                  imageUrl={api.imageUrl(wallToken, photo.id)}
                  layout="mobile"
                  onReact={!closed ? onReact : undefined}
                  reacting={reactBusyIds.has(String(photo.id))}
                  priority={index === 0}
                  onOpenViewer={openViewer}
                />
              </div>
            ))}

            {hasMore ? (
              <div ref={sentinelRef} className="qrw-infinite-sentinel" aria-hidden="true">
                {loadingMore ? <p className="qrw-loading-more">Loading more moments…</p> : null}
              </div>
            ) : (
              photos.length > 0 ? (
                <p className="qrw-end-feed" style={{ textAlign: 'center', color: '#8a9bb4', fontSize: '12px', padding: '16px 0' }}>
                  You're all caught up!
                </p>
              ) : null
            )}

            {isScrolledDown && newPostsQueue.length === 0 ? (
              <button
                type="button"
                className="qrw-scroll-top-button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                aria-label="Scroll to top of feed"
                title="Back to top"
              >
                <ArrowUp size={20} />
              </button>
            ) : null}
          </div>
        </> : null}
      </div>

      {showCreateModal ? (
        <div
          className="qrw-create-modal-backdrop"
          role="presentation"
          onClick={e => {
            if (e.target === e.currentTarget && !busy) {
              closeCreateModal();
            }
          }}
          style={{ backgroundColor: `rgba(10, 20, 42, ${getCreateSheetBackdropAlpha(createSheetDragY, window.innerHeight)})` }}
        >
          <div
            className={`qrw-create-modal${createSheetDragging ? ' is-dragging' : ''}${createSheetDismissing ? ' is-dismissing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="qrw-create-post-title"
            onClick={e => e.stopPropagation()}
            style={{ transform: `translate3d(0, ${createSheetDragY}px, 0)` }}
          >
            <div className="qrw-create-modal-header"
              onPointerDown={e => {
                if (busy || createSheetDismissing || window.innerWidth > 580
                  || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button')) return;
                const now = performance.now();
                createSheetGestureRef.current = {
                  pointerId: e.pointerId,
                  startY: e.clientY,
                  lastY: e.clientY,
                  lastTime: now,
                  offsetY: 0,
                  velocityY: 0,
                };
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setCreateSheetDragging(true);
              }}
              onPointerMove={e => {
                const gesture = createSheetGestureRef.current;
                if (gesture.pointerId !== e.pointerId || busy || createSheetDismissing) return;
                const now = performance.now();
                const elapsed = Math.max(1, now - gesture.lastTime);
                const rawOffset = e.clientY - gesture.startY;
                const offsetY = getCreateSheetDragOffset(rawOffset);
                gesture.velocityY = (e.clientY - gesture.lastY) / elapsed;
                gesture.lastY = e.clientY;
                gesture.lastTime = now;
                gesture.offsetY = offsetY;
                setCreateSheetDragY(offsetY);
              }}
              onPointerUp={e => {
                const gesture = createSheetGestureRef.current;
                if (gesture.pointerId !== e.pointerId) return;
                gesture.pointerId = null;
                e.currentTarget.releasePointerCapture?.(e.pointerId);
                setCreateSheetDragging(false);
                if (!busy && shouldDismissCreateSheet(gesture)) {
                  setCreateSheetDismissing(true);
                  setCreateSheetDragY(window.innerHeight + 80);
                  createSheetDismissTimerRef.current = window.setTimeout(closeCreateModal, 220);
                } else {
                  setCreateSheetDragY(0);
                }
              }}
              onPointerCancel={e => {
                if (createSheetGestureRef.current.pointerId !== e.pointerId) return;
                createSheetGestureRef.current.pointerId = null;
                setCreateSheetDragging(false);
                setCreateSheetDragY(0);
              }}>
              <span className="qrw-create-modal-drag-handle" aria-hidden="true" />
              <h2 id="qrw-create-post-title">Create Post</h2>
              <button
                type="button"
                className="qrw-create-modal-close"
                onClick={closeCreateModal}
                disabled={busy}
                aria-label="Close"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form className="qrw-create-modal-body" onSubmit={onUpload}>
              {modalError ? (
                <div className="qrw-alert qrw-alert-error" role="alert">
                  {modalError}
                </div>
              ) : null}

              <div className="qrw-composer-user-info">
                <span className={`qrw-avatar qrw-modal-user-avatar ${!name.trim() ? 'qrw-avatar--anon' : ''}`} aria-hidden="true">
                  {name.trim() ? (
                    name.trim().charAt(0).toUpperCase()
                  ) : (
                    <UserRound size={20} strokeWidth={2.2} className="qrw-avatar-icon" />
                  )}
                </span>
                <div className="qrw-modal-user-meta">
                  <strong className="qrw-modal-user-name">
                    {name.trim() || 'Guest'}
                  </strong>
                  <span className="qrw-modal-user-badge">Posting to {event?.title || 'Photo Wall'}</span>
                </div>
              </div>

              <div className="qrw-field-group">
                <label className="qrw-field-label" htmlFor="qrw-modal-name">
                  Your name <span className="qrw-required">*</span>
                </label>
                <input
                  id="qrw-modal-name"
                  ref={nameInputRef}
                  className="qrw-field"
                  autoComplete="name"
                  value={name}
                  maxLength={60}
                  required
                  disabled={busy}
                  placeholder="What should we call you?"
                  onChange={e => {
                    setName(e.target.value);
                    if (modalError) setModalError('');
                  }}
                />
              </div>

              <div className="qrw-field-group">
                <label className="qrw-field-label">
                  Photo <span className="qrw-required">*</span>
                </label>

                {files.length === 0 ? (
                  <>
                    <label className="qrw-upload-picker" htmlFor="qrw-modal-files">
                      <ImagePlus size={32} />
                      <strong>Tap to choose one photo</strong>
                      <small>JPG · PNG · WEBP · AVIF · HEIC* (max 10 MB)</small>
                    </label>
                    <input
                      id="qrw-modal-files"
                      ref={fileInputRef}
                      className="qrw-visually-hidden"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                      disabled={busy}
                      onChange={handleFileSelect}
                    />
                  </>
                ) : (
                  <>
                    <div className="qrw-composer-preview-container">
                      <div className="qrw-composer-preview-media">
                        <img
                          src={previews[0]?.url}
                          alt={`Selected ${files[0]?.name}`}
                          className="qrw-composer-preview-img"
                        />
                        <button
                          type="button"
                          className="qrw-composer-preview-remove"
                          onClick={handleRemovePhoto}
                          disabled={busy}
                          aria-label="Remove photo"
                          title="Remove photo"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="qrw-composer-preview-footer">
                        <span className="qrw-composer-preview-name" title={files[0]?.name}>
                          {files[0]?.name}
                        </span>
                        <button
                          type="button"
                          className="qrw-composer-preview-change-btn"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={busy}
                        >
                          Change photo
                        </button>
                      </div>
                    </div>
                    <input
                      id="qrw-modal-files"
                      ref={fileInputRef}
                      className="qrw-visually-hidden"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                      disabled={busy}
                      onChange={handleFileSelect}
                    />
                  </>
                )}
              </div>

              <div className="qrw-field-group">
                <label className="qrw-field-label" htmlFor="qrw-modal-caption">
                  Caption <span className="qrw-required">*</span>
                </label>
                <textarea
                  id="qrw-modal-caption"
                  required
                  className="qrw-field"
                  rows={3}
                  maxLength={240}
                  value={caption}
                  disabled={busy}
                  placeholder="Tell us about this moment…"
                  onChange={e => {
                    setCaption(e.target.value);
                  }}
                />
              </div>

              <button
                className="qrw-primary qrw-modal-submit"
                disabled={busy || !files.length || !name.trim() || !caption.trim()}
                type="submit"
              >
                <Send size={16} /> {busy ? 'Adding to queue…' : 'Submit photo for approval'}
              </button>

              <p className="qrw-small-print">
                *HEIC works when the server supports HEIF decoding. Approved photos are visible to event guests.
              </p>
            </form>
          </div>
        </div>
      ) : null}

      {showUploadConfirmation ? (
        <div
          className="qrw-upload-confirmation-backdrop"
          role="presentation"
          onClick={eventData => {
            if (eventData.target === eventData.currentTarget) dismissUploadConfirmation();
          }}
        >
          <section
            ref={uploadConfirmationDialogRef}
            className="qrw-upload-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qrw-upload-confirmation-title"
            aria-describedby="qrw-upload-confirmation-description"
            tabIndex={-1}
            onClick={eventData => eventData.stopPropagation()}
          >
            <button
              type="button"
              className="qrw-upload-confirmation-close"
              onClick={() => dismissUploadConfirmation()}
              aria-label="Close confirmation"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
            <span className="qrw-upload-confirmation-icon" aria-hidden="true">
              <CheckCircle2 size={32} strokeWidth={2.1} />
            </span>
            <h2 id="qrw-upload-confirmation-title">Photo submitted</h2>
            <p id="qrw-upload-confirmation-description">
              Your photo is waiting for moderator approval. It will appear in the feed once approved.
            </p>
          </section>
        </div>
      ) : null}

      {viewerPhoto ? (
        <div
          className="qrw-modal-backdrop qrw-viewer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Full size photo view"
          onClick={closeViewer}
          style={{ backgroundColor: `rgba(10, 20, 42, ${getViewerDragPresentation(viewerDragY, window.innerHeight).backdropAlpha})` }}
        >
          <div
            className={`qrw-viewer-dialog${viewerDragging ? ' is-dragging' : ''}${viewerDismissing ? ' is-dismissing' : ''}`}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => {
              if (viewerDismissing || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button')) return;
              const now = performance.now();
              viewerGestureRef.current = {
                pointerId: e.pointerId,
                startY: e.clientY,
                lastY: e.clientY,
                lastTime: now,
                offsetY: 0,
                velocityY: 0,
              };
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setViewerDragging(true);
            }}
            onPointerMove={e => {
              const gesture = viewerGestureRef.current;
              if (gesture.pointerId !== e.pointerId || viewerDismissing) return;
              const now = performance.now();
              const elapsed = Math.max(1, now - gesture.lastTime);
              const offsetY = e.clientY - gesture.startY;
              gesture.velocityY = (e.clientY - gesture.lastY) / elapsed;
              gesture.lastY = e.clientY;
              gesture.lastTime = now;
              gesture.offsetY = offsetY;
              setViewerDragY(offsetY);
            }}
            onPointerUp={e => {
              const gesture = viewerGestureRef.current;
              if (gesture.pointerId !== e.pointerId) return;
              gesture.pointerId = null;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              setViewerDragging(false);

              if (shouldDismissViewerDrag(gesture)) {
                viewerScrollTransferRef.current = {
                  offsetY: gesture.offsetY,
                  velocityY: gesture.velocityY,
                };
                setViewerDismissing(true);
                setViewerDragY(getViewerDismissTarget(gesture.offsetY || gesture.velocityY, window.innerHeight));
                viewerDismissTimerRef.current = window.setTimeout(closeViewer, 220);
              } else {
                setViewerDragY(0);
              }
            }}
            onPointerCancel={e => {
              if (viewerGestureRef.current.pointerId !== e.pointerId) return;
              viewerGestureRef.current.pointerId = null;
              setViewerDragging(false);
              setViewerDragY(0);
            }}
            style={{
              transform: `translate3d(0, ${viewerDragY}px, 0) scale(${getViewerDragPresentation(viewerDragY, window.innerHeight).scale})`,
            }}
          >
            <div className="qrw-viewer-toolbar">
              <button
                type="button"
                className="qrw-viewer-close"
                onClick={closeViewer}
                aria-label="Close full size view"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div className="qrw-viewer-image-wrap">
              <img
                className="qrw-viewer-image"
                src={viewerPhoto.images?.large || viewerPhoto.images?.feed || api.imageUrl(wallToken, viewerPhoto.id)}
                alt={viewerPhoto.caption || `Photo by ${viewerPhoto.uploadedBy}`}
                draggable="false"
              />
            </div>
            <div className="qrw-viewer-meta">
              <span className={`qrw-avatar ${!viewerPhoto.uploadedBy?.trim() ? 'qrw-avatar--anon' : ''}`} aria-hidden="true">
                {viewerPhoto.uploadedBy?.trim() ? (
                  viewerPhoto.uploadedBy.trim().charAt(0).toUpperCase()
                ) : (
                  <UserRound size={18} strokeWidth={2.2} className="qrw-avatar-icon" />
                )}
              </span>
              <div className="qrw-post-meta">
                <strong>{viewerPhoto.uploadedBy}</strong>
                <small>{dateLabel(viewerPhoto.createdAt)}</small>
              </div>
            </div>
            {viewerPhoto.caption ? (
              <p className="qrw-viewer-caption">
                {splitCaption(viewerPhoto.caption).map((part, index) => (
                  <span className={part.isHashtag ? 'qrw-caption-hashtag' : undefined} key={`${index}-${part.text}`}>
                    {part.text}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
