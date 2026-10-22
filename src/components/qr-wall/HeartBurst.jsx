import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

const MAX_HEARTS = 120; // Rendering cap only; database totals are unlimited.
const ANIMATION_MS = 4100;

function createHearts(rawCount, sequence, variant) {
  const count = Math.min(MAX_HEARTS, Math.max(0, Math.trunc(Number(rawCount) || 0)));
  const columns = Math.max(2, Math.ceil(Math.sqrt(count * 1.8)));
  const rows = Math.ceil(count / columns);
  const display = variant === 'display';
  const dense = count > 45;
  const colors = ['#f71951', '#fa3d6c', '#e90641', '#ff6792', '#ff2852'];
  const noise = (index, seed) => {
    const value = Math.sin((index + 1) * seed + sequence * 1.37) * 43758.5453;
    return value - Math.floor(value);
  };
  return Array.from({ length: count }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    // Jittered grid covers both image and white caption area, even at low counts.
    const x = 9 + ((col + .2 + noise(index, 13.1) * .6) / columns) * 82;
    const y = 17 + ((row + .2 + noise(index, 19.3) * .6) / rows) * 70;
    const width = (display ? (dense ? 54 : 82) : (dense ? 38 : 52))
      + noise(index, 23.1) * (display ? 46 : 30);
    const drift = (noise(index, 29.3) - .5) * (display ? 280 : 170);
    const rise = -(display ? 170 : 125) - noise(index, 37.1) * (display ? 215 : 145);
    return {
      key: `${sequence}-${index}`,
      style: {
        '--heart-x': `${x.toFixed(2)}%`,
        '--heart-y': `${y.toFixed(2)}%`,
        '--heart-size': `${Math.round(width)}px`,
        '--heart-drift': `${Math.round(drift)}px`,
        '--heart-rise': `${Math.round(rise)}px`,
        '--heart-drift-mid': `${Math.round(drift * .38)}px`,
        '--heart-rise-mid': `${Math.round(rise * .38)}px`,
        '--heart-rotation': `${Math.round((noise(index, 41.2) - .5) * 55)}deg`,
        '--heart-delay': `${Math.round(noise(index, 47.3) * 420)}ms`,
        '--reaction-color': colors[Math.min(colors.length - 1, Math.floor(noise(index, 53.7) * colors.length))],
      },
    };
  });
}

/** Plays a visual-only heart burst for {sequence, count}; never saves reactions. */
export default function HeartBurst({ burst, variant = 'feed' }) {
  const [hearts, setHearts] = useState([]);

  useEffect(() => {
    if (!burst?.sequence || !Number(burst.count)) {
      setHearts([]);
      return undefined;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setHearts([]);
      return undefined;
    }
    setHearts(createHearts(burst.count, burst.sequence, variant));
    const timer = window.setTimeout(() => setHearts([]), ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [burst?.sequence, burst?.count, variant]);

  if (!hearts.length) return null;
  return (
    <div className={`qrw-heart-burst qrw-heart-burst--${variant}`} aria-hidden="true">
      {hearts.map(heart => (
        <span key={heart.key} className="qrw-heart-particle" style={heart.style}>
          <Heart size={64} fill="currentColor" stroke="#fff3f8" strokeWidth={1.8} />
        </span>
      ))}
    </div>
  );
}
