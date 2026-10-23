import { useEffect, useState } from 'react';
import { getAnimatedHeartCount, getDisplayHeartX } from '../../pages/qr-wall/qrWallDisplayState';

const DISPLAY_ANIMATION_MS = 2000;
const FEED_ANIMATION_MS = 3000;

function createHearts(rawCount, sequence, variant) {
  const count = getAnimatedHeartCount(rawCount, variant);
  const columns = Math.max(2, Math.ceil(Math.sqrt(count * 1.8)));
  const rows = Math.ceil(count / columns);
  const display = variant === 'display';
  const dense = count > 45;
  const noise = (index, seed) => {
    const value = Math.sin((index + 1) * seed + sequence * 1.37) * 43758.5453;
    return value - Math.floor(value);
  };
  return Array.from({ length: count }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    // Display hearts originate beside the reaction control and stream upward
    // like story reactions. Feed hearts retain their existing broad spread.
    const x = display
      ? getDisplayHeartX(noise(index, 13.1)) + (noise(index, 17.7) - 0.5) * 14
      : 9 + ((col + .2 + noise(index, 13.1) * .6) / columns) * 82;
    const y = display
      ? 97.5 + noise(index, 19.3) * 2
      : 17 + ((row + .2 + noise(index, 19.3) * .6) / rows) * 70;
    const width = display
      ? 36 + noise(index, 23.1) * 30
      : (dense ? 38 : 52) + noise(index, 23.1) * 30;
    const drift = (noise(index, 29.3) - .5) * (display ? 240 : 160);
    const rise = -(display ? 280 : 130) - noise(index, 37.1) * (display ? 140 : 140);
    const delay = display ? index * 42 + noise(index, 47.3) * 22 : noise(index, 47.3) * 380;
    const duration = display ? 2000 : 3550;
    const rot = Math.round((noise(index, 41.2) - .5) * (display ? 18 : 36));
    return {
      key: `${sequence}-${index}`,
      style: {
        '--heart-x': `${x.toFixed(2)}%`,
        '--heart-y': `${y.toFixed(2)}%`,
        '--heart-size': `${Math.round(width)}px`,
        '--heart-drift': `${Math.round(drift)}px`,
        '--heart-rise': `${Math.round(rise)}px`,
        '--heart-rotation': `${rot}deg`,
        '--heart-delay': `${Math.round(delay)}ms`,
        '--heart-duration': `${Math.round(duration)}ms`,
      },
    };
  });
}

function GradientHeart({ gradientId }) {
  const clipId = `${gradientId}-clip`;
  const heartPath = 'M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z';
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="12%" y1="6%" x2="88%" y2="94%">
          <stop offset="0%" stopColor="#ffd3dc" />
          <stop offset="22%" stopColor="#ff7f98" />
          <stop offset="48%" stopColor="#f83259" />
          <stop offset="72%" stopColor="#d91d48" />
          <stop offset="100%" stopColor="#ae123d" />
        </linearGradient>
        <clipPath id={clipId}><path d={heartPath} /></clipPath>
      </defs>
      <path fill={`url(#${gradientId})`} d={heartPath} />
      <g clipPath={`url(#${clipId})`}>
        <path d="M2.5 7.6 12 5.1 8.8 13.2Z" fill="#fff" opacity=".08" />
        <path d="M12 5.1 21.5 7.6 15.2 13.2Z" fill="#7f0028" opacity=".07" />
        <path d="M8.8 13.2 15.2 13.2 12 21.5Z" fill="#ffb1bd" opacity=".06" />
        <path d="M2.4 7.6 8.8 13.2 4.8 14.8Z" fill="#ff4969" opacity=".07" />
      </g>
    </svg>
  );
}

/** Plays a visual-only heart burst for {sequence, count}; never saves reactions. */
export default function HeartBurst({ burst, variant = 'feed' }) {
  const [hearts, setHearts] = useState([]);
  const [activeSeq, setActiveSeq] = useState(null);

  if (burst?.sequence && burst.sequence !== activeSeq) {
    setActiveSeq(burst.sequence);
    if (typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setHearts(createHearts(burst.count, burst.sequence, variant));
    } else {
      setHearts([]);
    }
  }

  useEffect(() => {
    if (!hearts.length) return undefined;
    const timer = window.setTimeout(
      () => setHearts([]),
      variant === 'display' ? DISPLAY_ANIMATION_MS : FEED_ANIMATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [hearts, variant]);

  if (!hearts.length) return null;
  return (
    <div className={`qrw-heart-burst qrw-heart-burst--${variant}`} aria-hidden="true">
      {hearts.map(heart => (
        <span key={heart.key} className="qrw-heart-particle" style={heart.style}>
          <GradientHeart gradientId={`qrw-heart-gradient-${heart.key}`} />
        </span>
      ))}
    </div>
  );
}
