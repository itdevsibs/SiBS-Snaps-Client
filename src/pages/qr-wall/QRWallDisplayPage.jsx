import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera, ChevronLeft, ChevronRight, Heart, Maximize2,
  Pause, Play, QrCode, Radio, Share2, X,
} from 'lucide-react';
import { readableQrWallError } from '../../lib/axios/qrWallApi';
import HeartBurst from '../../components/qr-wall/HeartBurst';
import { splitCaption } from '../../components/qr-wall/captionText';
import { applyReactionChange, hasReactionIncrease, resolveRenderedPhoto } from './qrWallDisplayState';
import './qrWall.css';
import './anniversaryDisplay.css';

const SLIDE_DURATION_MS = 7000;
const CROSSFADE_MS = 650;
const VALID_TOKEN = /^[a-f\d]{48}$/i;

function timestamp(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Just now';
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
}

function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'S';
}

// Keep a few previously decoded photos locally so temporary backend/proxy
// outages cannot turn an already visible slide into a broken <img>.
// This is a bounded client-side display cache, not a limit on photo count.
const MAX_DECODED_SLIDES = 8;

async function decodePhotoObjectUrl(objectUrl) {
  const img = new Image();
  img.src = objectUrl;
  if (typeof img.decode === 'function') {
    await img.decode();
    return;
  }
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Uploaded photo cannot be decoded by the browser'));
  });
}

export default function QRWallDisplayPage({ api }) {
  const [event, setEvent] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [desiredId, setDesiredId] = useState(null);
  const [visibleId, setVisibleId] = useState(null);
  const [outgoingId, setOutgoingId] = useState(null);
  const [visiblePhotoSnapshot, setVisiblePhotoSnapshot] = useState(null);
  const [outgoingPhotoSnapshot, setOutgoingPhotoSnapshot] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [heartBurst, setHeartBurst] = useState(null);
  const burstSequenceRef = useRef(0);
  const lastBurstSlideRef = useRef({ token: null, photoId: null, count: 0 });
  const reactionCountsRef = useRef(new Map());
  const reactionPopSequenceRef = useRef(0);
  const reactionPopTimerRef = useRef(null);
  const [reactionPop, setReactionPop] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [imageWarning, setImageWarning] = useState(false);
  const eventRef = useRef(null);
  const cursorRef = useRef(null);
  const loadingPagesRef = useRef(false);
  const newestIdRef = useRef(null);
  const currentPhotoRef = useRef(null);
  const retryCycleRef = useRef(0);
  const [retryCycle, setRetryCycle] = useState(0);
  // Object URLs are held for a small number of recent slides only.
  // They remain readable when port 5001 temporarily disconnects.
  const decodedSlidesRef = useRef(new Map());
  const moderationRevisionRef = useRef(null);
  useEffect(() => () => {
    window.clearTimeout(reactionPopTimerRef.current);
    for (const objectUrl of decodedSlidesRef.current.values()) URL.revokeObjectURL(objectUrl);
    decodedSlidesRef.current.clear();
  }, []);

  const rememberPhoto = useCallback((id, objectUrl, protectId) => {
    const cache = decodedSlidesRef.current;
    const former = cache.get(id);
    if (former && former !== objectUrl) URL.revokeObjectURL(former);
    cache.delete(id);
    cache.set(id, objectUrl);
    // Do not evict the visible image or its outgoing crossfade frame.
    for (const [candidate, cachedUrl] of cache) {
      if (cache.size <= MAX_DECODED_SLIDES) break;
      if (candidate === id || candidate === protectId || candidate === currentPhotoRef.current) continue;
      URL.revokeObjectURL(cachedUrl);
      cache.delete(candidate);
    }
  }, []);


  const photoIds = useMemo(() => photos.map(photo => String(photo.id)), [photos]);
  const count = photos.length;
  const currentPhoto = resolveRenderedPhoto(photos, visibleId, visiblePhotoSnapshot);
  const outgoingPhoto = resolveRenderedPhoto(photos, outgoingId, outgoingPhotoSnapshot);
  const slideIndex = Math.max(0, photoIds.indexOf(visibleId));
  const liveEvent = event && VALID_TOKEN.test(event.token || '') ? event : null;

  // Central, monotonic trigger: a new burst restarts even if its count is the
  // same as the previous burst. Nothing is posted to the reaction API here.
  const playHeartBurst = useCallback((photoId, reactionCount) => {
    const total = Math.max(0, Math.trunc(Number(reactionCount) || 0));
    if (!photoId || !total) return;
    burstSequenceRef.current += 1;
    setHeartBurst({ sequence: burstSequenceRef.current, photoId: String(photoId), count: total });
  }, []);

  const playReactionPop = useCallback((photoId) => {
    if (!photoId) return;
    reactionPopSequenceRef.current += 1;
    setReactionPop({ sequence: reactionPopSequenceRef.current, photoId: String(photoId) });
    window.clearTimeout(reactionPopTimerRef.current);
    reactionPopTimerRef.current = window.setTimeout(() => setReactionPop(null), 900);
  }, []);

  // Run when a photo with existing reactions first appears, whenever the
  // slideshow returns to it, or when its reaction total increases live.
  // Ignore ordinary six-second feed polls and comment-only updates.
  useEffect(() => {
    if (!visibleId || !currentPhoto || !liveEvent) return;
    const total = Math.max(0, Math.trunc(Number(currentPhoto.reactionCount) || 0));
    const reactionKey = `${liveEvent.token}:${visibleId}`;
    const previousTotal = reactionCountsRef.current.get(reactionKey);
    const gainedReaction = hasReactionIncrease(previousTotal, total);
    reactionCountsRef.current.set(reactionKey, total);
    const old = lastBurstSlideRef.current;
    const changedPhoto = old.photoId !== visibleId || old.token !== liveEvent.token;
    const newReaction = !changedPhoto && total > old.count;
    lastBurstSlideRef.current = { token: liveEvent.token, photoId: visibleId, count: total };
    if (total > 0 && (changedPhoto || newReaction)) {
      playHeartBurst(visibleId, total);
    }
    if (gainedReaction) playReactionPop(visibleId);
  }, [visibleId, currentPhoto?.reactionCount, liveEvent?.token, playHeartBurst, playReactionPop]);

  const getFirstPage = useCallback(async (token, reset = false) => {
    if (!VALID_TOKEN.test(token || '')) return;
    const response = await api.getFeed(token, null, 60);
    if (eventRef.current?.token !== token) return;
    // If a moderator rejects/hides an earlier photo, discard stale feed rows.
    const revision = response?.event?.moderationRevision;
    const moderationChanged = revision !== undefined && moderationRevisionRef.current !== null
      && revision !== moderationRevisionRef.current;
    if (revision !== undefined) moderationRevisionRef.current = revision;
    const resetFeed = reset || moderationChanged;
    // React to updates in the slideshow effect below, rather than starting
    // a burst from this network callback (which runs on initial hydration).
    setPhotos(previous => {
      if (resetFeed) return response.photos || [];
      const seen = new Set((response.photos || []).map(photo => String(photo.id)));
      return [...(response.photos || []), ...previous.filter(photo => !seen.has(String(photo.id)))];
    });
    if (resetFeed) {
      cursorRef.current = response.nextCursor || null;
      setCursor(response.nextCursor || null);
      // Do not clear the rendered frame for moderation changes. The slideshow
      // transitions normally after the replacement image has decoded.
    }
    setError('');
  }, [api]);

  const loadActive = useCallback(async () => {
    try {
      const response = await api.getActive();
      const next = response?.event || null;
      if (next && !VALID_TOKEN.test(next.token || '')) throw new Error('Invalid event token returned by the server.');
      const previousToken = eventRef.current?.token;
      eventRef.current = next;
      setEvent(next);
      if (previousToken !== next?.token) {
        cursorRef.current = null;
        newestIdRef.current = null;
        currentPhotoRef.current = null;
        moderationRevisionRef.current = null;
        lastBurstSlideRef.current = { token: null, photoId: null, count: 0 };
        reactionCountsRef.current.clear();
        window.clearTimeout(reactionPopTimerRef.current);
        setHeartBurst(null);
        setReactionPop(null);
        // An image from a previous event must not remain cached or visible.
        for (const objectUrl of decodedSlidesRef.current.values()) URL.revokeObjectURL(objectUrl);
        decodedSlidesRef.current.clear();
        setCursor(null);
        setPhotos([]);
        setVisibleId(null);
        setDesiredId(null);
        setOutgoingId(null);
        setVisiblePhotoSnapshot(null);
        setOutgoingPhotoSnapshot(null);
        if (next?.token) await getFirstPage(next.token, true);
      }
      setError('');
    } catch (err) {
      setError(readableQrWallError(err, 'Could not connect to the photo wall server.'));
    } finally {
      setLoading(false);
    }
  }, [api, getFirstPage]);

  const fetchMore = useCallback(async () => {
    const token = eventRef.current?.token;
    const before = cursorRef.current;
    if (!token || !before || loadingPagesRef.current) return;
    loadingPagesRef.current = true;
    try {
      const response = await api.getFeed(token, before, 60);
      if (eventRef.current?.token !== token) return;
      setPhotos(previous => {
        const known = new Set(previous.map(photo => String(photo.id)));
        return [...previous, ...(response.photos || []).filter(photo => !known.has(String(photo.id)))];
      });
      cursorRef.current = response.nextCursor || null;
      setCursor(response.nextCursor || null);
    } catch (err) {
      setError(readableQrWallError(err));
    } finally { loadingPagesRef.current = false; }
  }, [api]);

  useEffect(() => {
    void loadActive();
    const poll = window.setInterval(() => void loadActive(), 12000);
    // Keep polling usable even if the live event stream is blocked by a proxy.
    const events = typeof EventSource !== 'undefined' ? new EventSource(api.activeStreamUrl()) : null;
    events?.addEventListener('change', loadActive);
    return () => { window.clearInterval(poll); events?.close(); };
  }, [api, loadActive]);

  useEffect(() => {
    if (!liveEvent) return undefined;
    const token = liveEvent.token;
    const refresh = () => getFirstPage(token).catch(err => setError(readableQrWallError(err)));
    const handleChange = eventMessage => {
      try {
        const change = JSON.parse(eventMessage.data || '{}');
        setPhotos(previous => applyReactionChange(previous, change));
      } catch { /* Feed refresh below remains authoritative. */ }
      refresh();
    };
    const stream = typeof EventSource !== 'undefined' ? new EventSource(api.streamUrl(token)) : null;
    stream?.addEventListener('change', handleChange);
    const poll = window.setInterval(refresh, 6000);
    return () => { stream?.close(); window.clearInterval(poll); };
  }, [api, liveEvent?.token, getFirstPage]);

  // Page through the entire library. 60 is only the API page size, not a wall limit.
  useEffect(() => {
    if (cursor && liveEvent?.token) void fetchMore();
  }, [cursor, liveEvent?.token, fetchMore]);

  // Preserve the current slide on comment updates; show genuinely new photos promptly.
  useEffect(() => {
    if (!photos.length) {
      setDesiredId(null);
      newestIdRef.current = null;
      currentPhotoRef.current = null;
      setVisibleId(null);
      setOutgoingId(null);
      setVisiblePhotoSnapshot(null);
      setOutgoingPhotoSnapshot(null);
      return;
    }
    const newest = String(photos[0].id);
    const before = newestIdRef.current;
    newestIdRef.current = newest;
    const newlyUploaded = before && /^\d+$/.test(before) && /^\d+$/.test(newest)
      && BigInt(newest) > BigInt(before);
    setDesiredId(previous => (!previous || !photos.some(photo => String(photo.id) === previous) || newlyUploaded)
      ? newest : previous);
  }, [photos]);

  // Only show the next photo AFTER downloading AND decoding its actual image.
  // Render with an object URL instead of making a second HTTP request in <img>.
  // This also preserves the last good slide while the API/SMB is unavailable.
  useEffect(() => {
    if (!desiredId || !liveEvent) return undefined;
    if (!photos.some(item => String(item.id) === desiredId)) return undefined;

    let cancelled = false;
    let retryTimeout;
    const controller = new AbortController();
    const selectVisible = () => {
      if (cancelled) return;
      const selectedPhoto = photos.find(photo => String(photo.id) === desiredId);
      if (!selectedPhoto) return;
      setImageWarning(false);
      setImageUnavailable(false);
      if (currentPhotoRef.current !== desiredId) {
        const oldId = currentPhotoRef.current;
        currentPhotoRef.current = desiredId;
        setOutgoingPhotoSnapshot(currentPhoto);
        setVisiblePhotoSnapshot(selectedPhoto);
        setOutgoingId(oldId);
        setVisibleId(desiredId);
      }
    };
    if (decodedSlidesRef.current.has(desiredId)) {
      selectVisible();
      return undefined;
    }

    const loadAndDecode = async () => {
      let objectUrl = null;
      try {
        const selected = photos.find(photo => String(photo.id) === desiredId);
        const requestUrl = selected?.images?.large || selected?.images?.feed || api.imageUrl(liveEvent.token, desiredId);
        const url = retryCycle > 0 ? `${requestUrl}${requestUrl.includes('?') ? '&' : '?'}attempt=${retryCycle}` : requestUrl;
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
          throw new Error(`Photo endpoint unavailable (HTTP ${response.status})`);
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error('Photo returned no image bytes');
        objectUrl = URL.createObjectURL(blob);
        await decodePhotoObjectUrl(objectUrl);
        if (cancelled) return;
        rememberPhoto(desiredId, objectUrl, currentPhotoRef.current);
        objectUrl = null; // Cache now owns it; revoke on eviction/unmount.
        selectVisible();
      } catch (error) {
        if (cancelled || error?.name === 'AbortError') return;
        // Do not discard any saved photo records or clear the current slide.
        console.warn('[SiBS-Snaps] Image unavailable; retaining last decoded photo', {
          photoId: desiredId, message: error?.message,
        });
        setImageWarning(true);
        setImageUnavailable(true);
        retryTimeout = window.setTimeout(() => {
          if (cancelled) return;
          if (photoIds.length > 1) {
            const position = photoIds.indexOf(desiredId);
            setDesiredId(photoIds[(position + 1) % photoIds.length]);
          } else {
            retryCycleRef.current += 1;
            setRetryCycle(retryCycleRef.current);
          }
        }, 2300);
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    };
    void loadAndDecode();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(retryTimeout);
    };
    // Depend on stable photo IDs, not the mutable feed data refreshed every 6s.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, liveEvent?.token, desiredId, retryCycle, rememberPhoto]);

  useEffect(() => {
    if (!outgoingId) return undefined;
    const timer = window.setTimeout(() => {
      setOutgoingId(null);
      setOutgoingPhotoSnapshot(null);
    }, CROSSFADE_MS);
    return () => window.clearTimeout(timer);
  }, [outgoingId, visibleId]);

  const advance = useCallback((delta) => {
    if (!photoIds.length) return;
    const id = currentPhotoRef.current || desiredId || photoIds[0];
    const position = photoIds.indexOf(id);
    const next = photoIds[((position < 0 ? 0 : position) + delta + photoIds.length) % photoIds.length];
    if (next === id) {
      retryCycleRef.current += 1;
      setRetryCycle(retryCycleRef.current);
    }
    setDesiredId(next);
  }, [photoIds, desiredId]);

  // Live feed refreshes every 6 seconds. Even when IDs stay the same, those
  // refreshes produce a new `photoIds` array and a new `advance` callback.
  // Keep the latest callback in a ref so it never restarts the 7-second timer.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Only restart autoplay after a real slide change or pause/resume. Feed
  // moderation must not restart the timer or interrupt the slide animation.
  // When a photo fails to decode, the existing error handler moves to the next
  // one; the counter still includes all uploaded photos.
  useEffect(() => {
    if (!playing || !visibleId || photoIds.length < 2 || desiredId !== visibleId) return undefined;
    const timer = window.setTimeout(() => advanceRef.current(1), SLIDE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [playing, visibleId, desiredId]);

  // Retry failed files on later cycles without permanently removing any records.
  useEffect(() => {
    if (!liveEvent) return undefined;
    const timer = window.setInterval(() => {
      retryCycleRef.current += 1;
      setRetryCycle(retryCycleRef.current);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [liveEvent?.token]);

  const openFullscreen = () => {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };
  // Use the same-origin route for the on-screen link. Opening an external Dev Tunnel
  // in a new tab may be blocked by Chrome or a tunnel confirmation page.
  // The QR SVG itself still carries the server-configured PUBLIC join URL.
  const joinPath = liveEvent ? `/photo-wall/join/${liveEvent.token}` : '';
  const dots = count <= 9 ? photoIds : photoIds.slice(Math.max(0, slideIndex - 4), Math.max(0, slideIndex - 4) + 9);

  return (
    <main className="qrw qrw-anniversary" aria-label="SiBS Anniversary Live Photo Wall">
      <div className="qrw-anniversary-art" aria-hidden="true" />
      <header className="qrw-anniversary-header">
        <div className="qrw-snap-brand" aria-label="SiBS-Snaps">
          <Camera className="qrw-snap-camera" aria-hidden="true" size={48} strokeWidth={1.8} />
          <div className="qrw-snap-brand-copy">
            <div className="qrw-snap-brand-name"><span>SiBS</span><span>-Snaps</span></div>
            <div className="qrw-snap-tagline">CAPTURE&nbsp; SHARE&nbsp; CELEBRATE</div>
          </div>
        </div>
        <div className="qrw-anniversary-heading">
          <div className="qrw-gold-crown" aria-hidden="true">♛</div>
          <h1>SiBS 15<sup>th</sup> Anniversary</h1>
          <p>A Crystal Anniversary Celebration</p>
        </div>
        <div className="qrw-anniversary-status">
          <div className="qrw-shared-counter"><strong>{count.toLocaleString('en-PH')}</strong><span>Moments Shared</span></div>
          <div className="qrw-live-badge"><Radio size={18} aria-hidden="true"/><span>LIVE</span></div>
          <button type="button" className="qrw-anniv-fullscreen" title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={openFullscreen}>
            <Maximize2 size={19} />
          </button>
        </div>
      </header>

      <div className="qrw-anniversary-main">
        <div className="qrw-anniversary-content">
          <button className="qrw-anniversary-arrow qrw-anniversary-arrow-left" type="button" onClick={() => advance(-1)}
            disabled={count < 2} aria-label="Previous photo"><ChevronLeft size={37} /></button>
          <section className="qrw-anniversary-card" aria-label="Featured photo">
            <div className="qrw-anniversary-image-stage">
              {currentPhoto && liveEvent ? (
                <>
                  {outgoingPhoto && decodedSlidesRef.current.has(String(outgoingPhoto.id)) ? (
                    <img key={`old-${outgoingPhoto.id}`} className="qrw-anniv-photo qrw-anniv-photo-out"
                      src={decodedSlidesRef.current.get(String(outgoingPhoto.id))} alt="" aria-hidden="true" />
                  ) : null}
                  <img key={`photo-${currentPhoto.id}`} className="qrw-anniv-photo qrw-anniv-photo-in"
                    src={decodedSlidesRef.current.get(String(currentPhoto.id)) || ''}
                    alt={currentPhoto.caption || `Uploaded by ${currentPhoto.uploadedBy}`} />
                  <div className="qrw-anniv-slide-count"><Camera size={14} /> {slideIndex + 1} / {count}</div>
                </>
              ) : (
                <div className="qrw-anniversary-empty" role="status"><Camera size={48} />
                  <strong>{loading ? 'Loading anniversary moments…' : liveEvent ? 'Be the first to share!' : 'Waiting for the live wall'}</strong>
                  <span>{liveEvent ? 'Scan the QR code to upload your photo.' : 'The event will appear here once it becomes active.'}</span>
                </div>
              )}
              <HeartBurst burst={heartBurst?.photoId === visibleId ? heartBurst : null} variant="display" />
            </div>
            <div className="qrw-anniversary-post">
              <div className="qrw-anniversary-post-head">
                <div className="qrw-anniv-avatar">{initials(currentPhoto?.uploadedBy)}</div>
                <div className="qrw-anniv-author"><strong>{currentPhoto?.uploadedBy || 'SiBS-Snaps'}</strong><span>{currentPhoto ? timestamp(currentPhoto.createdAt) : 'Celebrating 15 years together'}</span></div>
                <span className="qrw-anniv-more" aria-hidden="true">•••</span>
              </div>
              <div className="qrw-anniversary-caption">
                <p key={currentPhoto?.id || 'empty'}>
                  {splitCaption(currentPhoto?.caption || 'Every moment is worth celebrating together. 💙')
                    .map((part, index) => (
                      <span className={part.isHashtag ? 'qrw-caption-hashtag' : undefined}
                        key={`${index}-${part.text}`}>{part.text}</span>
                    ))}
                </p>
              </div>
              <div className="qrw-anniv-actions">
                <button type="button" className="qrw-anniv-reaction"
                  title="Replay heart celebration animation" aria-label={`Celebrate ${currentPhoto?.uploadedBy || 'this photo'}: replay hearts`}
                  disabled={!currentPhoto || Number(currentPhoto.reactionCount || 0) < 1}
                  onClick={() => {
                    playHeartBurst(visibleId, currentPhoto?.reactionCount);
                    playReactionPop(visibleId);
                  }}>
                  <span key={`${visibleId}-${reactionPop?.photoId === visibleId ? reactionPop.sequence : 'idle'}`}
                    className={`qrw-reaction-pop-content${reactionPop?.photoId === visibleId ? ' is-popping' : ''}`}>
                    <span className="qrw-reaction-pop-visual" aria-hidden="true">
                      <span className="qrw-reaction-pop-ring" />
                      <Heart className="qrw-reaction-pop-heart" size={29} fill="currentColor" />
                      <span className="qrw-reaction-pop-sparks">
                        <i /><i /><i /><i />
                      </span>
                    </span>
                    <span className="qrw-reaction-pop-label">{Number(currentPhoto?.reactionCount || 0)} {Number(currentPhoto?.reactionCount || 0) === 1 ? 'reaction' : 'reactions'}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setShowQr(true)} aria-label="Show QR code to share a photo"><Share2 size={29}/><span>Share</span></button>
              </div>
            </div>
          </section>
          <button className="qrw-anniversary-arrow qrw-anniversary-arrow-right" type="button" onClick={() => advance(1)}
            disabled={count < 2} aria-label="Next photo"><ChevronRight size={37} /></button>
        </div>
        {error ? <div className="qrw-anniv-error" role="alert">{error}</div> : null}
        {imageUnavailable && imageWarning ? <p className="qrw-anniv-retry" role="status">One photo could not load. Retrying automatically; saved photo records are preserved.</p> : null}
        <div className="qrw-anniv-navigation">
          <div className="qrw-anniv-dots" aria-label="Slideshow navigation">
            {dots.map(id => <button type="button" key={id} className={id === visibleId ? 'active' : ''}
              onClick={() => setDesiredId(id)} aria-label={`Show photo ${photoIds.indexOf(id) + 1}`}
              aria-current={id === visibleId ? 'true' : undefined} />)}
          </div>
          <button type="button" className="qrw-anniv-pause" onClick={() => setPlaying(!playing)}
            title={playing ? 'Pause slideshow' : 'Play slideshow'} aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}>
            {playing ? <Pause size={29} fill="currentColor" /> : <Play size={27} fill="currentColor" />}
          </button>
          <span className="qrw-anniv-slideshow-hint">{playing ? 'AUTO PLAY' : 'PAUSED'} · {Math.round(SLIDE_DURATION_MS / 1000)}s</span>
        </div>
      </div>
      <aside className="qrw-anniv-years" aria-hidden="true"><span>15</span><strong>YEARS</strong></aside>
      {liveEvent ? (
        <div className="qrw-anniv-join-dock">
          <img src={api.qrUrl(liveEvent.token)} alt="QR code to join SiBS Anniversary" onClick={() => setShowQr(true)} />
          <button type="button" onClick={() => setShowQr(true)}><QrCode size={14}/> SCAN TO JOIN</button>
        </div>
      ) : null}
      {showQr && liveEvent ? (
        <div className="qrw-anniv-qr-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowQr(false); }}>
          <div className="qrw-anniv-qr-dialog" role="dialog" aria-modal="true" aria-label="Scan to join the live photo wall">
            <button type="button" className="qrw-anniv-qr-close" onClick={() => setShowQr(false)} aria-label="Close QR code"><X size={21}/></button>
            <QrCode size={27} color="#1654a0" />
            <h2>Join the Moment</h2>
            <p>Scan with your phone to upload a photo. No login required.</p>
            <img src={api.qrUrl(liveEvent.token)} alt="Scan this code to upload your photo" />
            <Link to={joinPath}>Open photo upload page on this device</Link>
          </div>
        </div>
      ) : null}
    </main>
  );
}
