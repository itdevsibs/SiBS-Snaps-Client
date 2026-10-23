import React, { useEffect, useRef, useState } from 'react';
import { CameraOff, Heart, RotateCcw, UserRound } from 'lucide-react';
import { shouldPlayCelebratePop } from '../../pages/qr-wall/qrWallDisplayState';
import { resolveImageVariants } from '../../pages/qr-wall/qrWallFeedState';
import { splitCaption } from './captionText';

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

function PhotoPost({
  photo,
  imageUrl,
  layout = 'display',
  onReact,
  reacting = false,
  priority = false,
  onOpenViewer,
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [reactionPopSequence, setReactionPopSequence] = useState(0);
  const [showBigHeart, setShowBigHeart] = useState(false);
  const [bigHeartKey, setBigHeartKey] = useState(0);

  const clickTimerRef = useRef(null);
  const lastClickTimeRef = useRef(0);
  const lastTouchTapTimeRef = useRef(0);
  const lastTouchTapPosRef = useRef({ x: 0, y: 0 });
  const touchStartPosRef = useRef({ x: 0, y: 0 });
  const touchMovedRef = useRef(false);
  const preventNextClicksRef = useRef(0);
  const lastDoubleReactionRef = useRef(0);
  const bigHeartTimeoutRef = useRef(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (bigHeartTimeoutRef.current) clearTimeout(bigHeartTimeoutRef.current);
    };
  }, []);

  const {
    feedSrc,
    srcSet,
    sizes,
  } = resolveImageVariants(photo, imageUrl);

  const [prevSrc, setPrevSrc] = useState(feedSrc);
  if (prevSrc !== feedSrc) {
    setPrevSrc(feedSrc);
    setAttempt(0);
    setFailed(false);
  }

  // A temporary read error must not leave a broken-image icon forever.
  useEffect(() => {
    if (!failed || attempt >= 3) return undefined;
    const delays = [3000, 8000, 16000];
    const timer = window.setTimeout(() => {
      setAttempt(current => current + 1);
      setFailed(false);
    }, delays[attempt]);
    return () => window.clearTimeout(timer);
  }, [failed, attempt]);

  const retry = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setAttempt(current => current + 1);
    setFailed(false);
  };

  const activeSrc = attempt > 0
    ? `${feedSrc}${feedSrc.includes('?') ? '&' : '?'}retry=${attempt}`
    : feedSrc;

  const triggerBigHeart = () => {
    setBigHeartKey(key => key + 1);
    setShowBigHeart(true);
    if (bigHeartTimeoutRef.current) {
      clearTimeout(bigHeartTimeoutRef.current);
    }
    bigHeartTimeoutRef.current = setTimeout(() => {
      setShowBigHeart(false);
      bigHeartTimeoutRef.current = null;
    }, 720);
  };

  const toggleCelebrate = async () => {
    if (!onReact || reacting) return;
    const response = await onReact(photo);
    if (shouldPlayCelebratePop(response)) setReactionPopSequence(previous => previous + 1);
  };

  const triggerDoubleReaction = (e) => {
    if (e) {
      if (e.stopPropagation) e.stopPropagation();
      if (e.preventDefault && e.type !== 'touchend') e.preventDefault();
    }

    const now = Date.now();
    // Guard against redundant execution from overlapping native and touch dispatches
    if (now - lastDoubleReactionRef.current < 350) {
      return;
    }
    lastDoubleReactionRef.current = now;

    // Cancel pending single-click viewer action
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    triggerBigHeart();
    void toggleCelebrate();
  };

  const handleWrapClick = (e) => {
    if (failed) return;
    const now = Date.now();

    // If mobile double-tap was already handled via touch, suppress synthetic click
    if (now < preventNextClicksRef.current) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      return;
    }

    const timeSinceLastClick = now - lastClickTimeRef.current;
    if (timeSinceLastClick < 280 && lastClickTimeRef.current > 0) {
      lastClickTimeRef.current = 0;
      triggerDoubleReaction(e);
      return;
    }

    lastClickTimeRef.current = now;

    if (onOpenViewer) {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onOpenViewer(photo);
      }, 260);
    }
  };

  const handleTouchStart = (e) => {
    if (failed || e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    touchMovedRef.current = false;
  };

  const handleTouchMove = (e) => {
    if (touchMovedRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      touchMovedRef.current = true;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (failed || touchMovedRef.current) return;
    const now = Date.now();
    const touch = e.changedTouches?.[0];
    const x = touch?.clientX ?? 0;
    const y = touch?.clientY ?? 0;

    const timeDiff = now - lastTouchTapTimeRef.current;
    const dist = Math.hypot(x - lastTouchTapPosRef.current.x, y - lastTouchTapPosRef.current.y);

    if (timeDiff > 0 && timeDiff < 320 && dist < 45) {
      lastTouchTapTimeRef.current = 0;
      preventNextClicksRef.current = now + 500;
      triggerDoubleReaction(e);
    } else {
      lastTouchTapTimeRef.current = now;
      lastTouchTapPosRef.current = { x, y };
    }
  };

  return (
    <article className={`qrw-post qrw-post--${layout}`}>
      <div className="qrw-post-head">
        <span className={`qrw-avatar ${!photo.uploadedBy?.trim() ? 'qrw-avatar--anon' : ''}`} aria-hidden="true">
          {photo.uploadedBy?.trim() ? (
            photo.uploadedBy.trim().charAt(0).toUpperCase()
          ) : (
            <UserRound size={17} strokeWidth={2.2} className="qrw-avatar-icon" />
          )}
        </span>
        <span className="qrw-post-meta"><strong>{photo.uploadedBy}</strong><small>{dateLabel(photo.createdAt)}</small></span>
      </div>
      <div
        className="qrw-post-image-wrap"
        onClick={handleWrapClick}
        onDoubleClick={triggerDoubleReaction}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role={onOpenViewer && !failed ? 'button' : undefined}
        tabIndex={onOpenViewer && !failed ? 0 : undefined}
        onKeyDown={e => {
          if (onOpenViewer && !failed && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
            }
            onOpenViewer(photo);
          }
        }}
        aria-label={onOpenViewer && !failed ? `View full photo by ${photo.uploadedBy}` : undefined}
      >
        {showBigHeart ? (
          <div className="qrw-double-tap-heart-overlay" aria-hidden="true">
            <div key={bigHeartKey} className="qrw-double-tap-heart">
              <Heart size={82} strokeWidth={1.5} />
            </div>
          </div>
        ) : null}

        {failed ? (
          <div className="qrw-post-image-retry" role="status">
            <CameraOff size={27} aria-hidden="true" />
            <span>Photo temporarily unavailable</span>
            <button type="button" onClick={retry} aria-label={`Retry loading photo by ${photo.uploadedBy}`}>
              <RotateCcw size={15} /> Retry photo
            </button>
          </div>
        ) : (
          <img
            className="qrw-post-image"
            src={activeSrc}
            srcSet={srcSet}
            sizes={sizes}
            alt={photo.caption || `Photo by ${photo.uploadedBy}`}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding={priority ? 'sync' : 'async'}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="qrw-post-content">
        <div className="qrw-reaction-row">
          <button
            type="button"
            className={`qrw-heart-button${photo.reacted ? ' is-reacted' : ''}`}
            onClick={() => void toggleCelebrate()}
            disabled={!onReact || reacting}
            aria-pressed={Boolean(photo.reacted)}
            aria-label={`${photo.reacted ? 'Remove your reaction' : 'Celebrate this photo'}; ${Number(photo.reactionCount || 0)} reactions`}
            title={photo.reacted ? 'Tap to remove your reaction' : 'Celebrate this moment'}
          >
            <span key={`${photo.id}-${reactionPopSequence}`}
              className={`qrw-reaction-pop-content${reactionPopSequence ? ' is-popping' : ''}`}>
              <span className="qrw-reaction-pop-visual" aria-hidden="true">
                <span className="qrw-reaction-pop-ring" />
                <Heart className="qrw-reaction-pop-heart" size={19}
                  fill={photo.reacted ? 'currentColor' : 'none'} strokeWidth={2.2} />
                <span className="qrw-reaction-pop-sparks"><i /><i /><i /><i /></span>
              </span>
              <span className="qrw-reaction-pop-label">{reacting
                ? (photo.reacted ? 'Removing…' : 'Saving…')
                : (photo.reacted ? 'Celebrated' : 'Celebrate')}</span>
            </span>
          </button>
          <span className="qrw-heart-count" aria-live="polite">{Number(photo.reactionCount || 0)} {Number(photo.reactionCount || 0) === 1 ? 'reaction' : 'reactions'}</span>
        </div>
        {photo.caption ? (
          <p className="qrw-caption">
            {splitCaption(photo.caption).map((part, index) => (
              <span className={part.isHashtag ? 'qrw-caption-hashtag' : undefined}
                key={`${index}-${part.text}`}>{part.text}</span>
            ))}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default React.memo(PhotoPost);
