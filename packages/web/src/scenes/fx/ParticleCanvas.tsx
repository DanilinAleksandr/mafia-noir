/**
 * Холст частиц поверх сцены. Время берёт у таймлайна сцены (getTime), поэтому частицы
 * замедляются, замирают и перематываются вместе с ней. Следит за частотой кадров:
 * если сцена тормозит, качество понижается до конца сессии.
 */
import { useEffect, useRef } from 'react';
import { downgradeQuality, type Quality } from '../../settings/prefs';
import { type Burst, drawBursts } from './particles';

export function ParticleCanvas({
  bursts,
  getTime,
  quality,
  className = 'pointer-events-none absolute inset-0 h-full w-full',
}: {
  bursts: readonly Burst[];
  getTime: () => number;
  quality: Quality;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const burstsRef = useRef(bursts);
  burstsRef.current = bursts;

  useEffect(() => {
    if (quality === 'reduced') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d') ?? null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 'full' ? 2 : 1);
    const density = quality === 'full' ? 1 : 0.45;
    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let frame = 0;
    let last = performance.now();
    let slowFrames = 0;
    let measured = 0;
    let lastTime = -1;
    const loop = (now: number) => {
      const time = getTime();
      if (time !== lastTime) {
        const alive = drawBursts(ctx, width, height, burstsRef.current, time, density);
        lastTime = time;
        // считаем кадры только пока частицы живы: просадка вне эффектов не наша
        if (alive) {
          measured++;
          if (now - last > 34) slowFrames++;
          if (measured >= 45 && slowFrames / measured > 0.35 && quality === 'full') downgradeQuality();
        }
      }
      last = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [getTime, quality]);

  if (quality === 'reduced') return null;
  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
