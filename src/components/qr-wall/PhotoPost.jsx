import { useEffect, useState } from 'react';
import { CameraOff, Heart, RotateCcw } from 'lucide-react';
import HeartBurst from './HeartBurst';

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

export default function PhotoPost({ photo, imageUrl, layout = 'display', onReact, reacting = false }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [heartBurst, setHeartBurst] = useState(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [imageUrl]);

  // A temporary SMB read error must not leave a broken-image icon forever.
  // Only cards actually mounted on screen attempt an image download (lazy load).
  useEffect(() => {
    if (!failed || attempt >= 3) return undefined;
    const delays = [3000, 8000, 16000];
    const timer = window.setTimeout(() => {
      setAttempt(current => current + 1);
      setFailed(false);
    }, delays[attempt]);
    return () => window.clearTimeout(timer);
  }, [failed, attempt]);

  const retry = () => {
    setAttempt(current => current + 1);
    setFailed(false);
  };
  const url = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}retry=${attempt}`;

  const toggleCelebrate = async () => {
    if (!onReact || reacting) return;
    const response = await onReact(photo);
    // Only animate a newly added reaction, not an unreact or failed request.
    if (response?.reacted && !response.alreadyReacted) {
      setHeartBurst(previous => ({
        sequence: (previous?.sequence || 0) + 1,
        count: Math.max(1, Number(response.reactionCount || 1)),
      }));
    }
  };


  return (
    <article className={`qrw-post qrw-post--${layout}`}>
      <HeartBurst burst={heartBurst} variant="feed" />
      <div className="qrw-post-image-wrap">
        {failed ? (
          <div className="qrw-post-image-retry" role="status">
            <CameraOff size={27} aria-hidden="true" />
            <span>Photo temporarily unavailable</span>
            <button type="button" onClick={retry} aria-label={`Retry loading photo by ${photo.uploadedBy}`}>
              <RotateCcw size={15} /> Retry photo
            </button>
          </div>
        ) : (
          <img className="qrw-post-image" src={url}
            alt={photo.caption || `Photo by ${photo.uploadedBy}`} loading="lazy"
            onError={() => setFailed(true)} />
        )}
      </div>
      <div className="qrw-post-content">
        <div className="qrw-post-head">
          <span className="qrw-avatar" aria-hidden="true">{(photo.uploadedBy || '?').charAt(0).toUpperCase()}</span>
          <span className="qrw-post-meta"><strong>{photo.uploadedBy}</strong><small>{dateLabel(photo.createdAt)}</small></span>
        </div>
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
            <Heart size={19} fill={photo.reacted ? 'currentColor' : 'none'} strokeWidth={2.2} />
            <span>{reacting ? (photo.reacted ? 'Removing…' : 'Saving…') : (photo.reacted ? 'Celebrated' : 'Celebrate')}</span>
          </button>
          <span className="qrw-heart-count" aria-live="polite">{Number(photo.reactionCount || 0)} {Number(photo.reactionCount || 0) === 1 ? 'reaction' : 'reactions'}</span>
        </div>
        {photo.caption ? <p className="qrw-caption">{photo.caption}</p> : null}
      </div>
    </article>
  );
}
