import { useEffect, useRef } from 'react';
import { useProgress, useSettings } from '../../stores';

const COLORS = ['#e8994a', '#f472b6', '#38bdf8', '#facc15', '#4ade80', '#a78bfa'];

// Full-window confetti burst whenever the progress store's `burst` changes.
// Skipped when animations are off or the system asks for reduced motion.
export default function Confetti() {
  const burst = useProgress((s) => s.burst);
  const animation = useSettings((s) => s.settings?.animation);
  const ref = useRef(null);

  useEffect(() => {
    if (!burst || animation === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const pieces = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    let frame;
    const start = performance.now();
    const tick = (t) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const fade = Math.max(0, 1 - (t - start - 1800) / 900);
      for (const p of pieces) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (fade > 0) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [burst, animation]);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 h-full w-full" />;
}
