/**
 * Эффект голограммы для карточки: наклон за пальцем и за гироскопом (если доступен), блик,
 * радужная «плёнка» и параллакс слоёв (`.holo-layer` с --depth). Всё — transform и opacity.
 * Без ввода карточка медленно «дышит», чтобы голограмма жила и на скриншоте.
 */
import { motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useSpring, useTransform } from 'framer-motion';
import { type ReactNode, useEffect, useRef } from 'react';
import { cx } from './ui';

const MAX_X = 16;
const MAX_Y = 12;

export function HoloCard({
  children,
  width,
  disabled = false,
  idle = true,
  className,
}: {
  children: ReactNode;
  width: number;
  disabled?: boolean;
  /** Медленное покачивание без ввода. */
  idle?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const sx = useSpring(tx, { stiffness: 140, damping: 16, mass: 0.6 });
  const sy = useSpring(ty, { stiffness: 140, damping: 16, mass: 0.6 });
  const rotateY = useTransform(sx, (v) => v * MAX_X);
  const rotateX = useTransform(sy, (v) => -v * MAX_Y);
  const glareX = useTransform(sx, (v) => `${50 + v * 45}%`);
  const glareY = useTransform(sy, (v) => `${40 + v * 45}%`);
  const foilShift = useTransform(sx, (v) => `${50 + v * 60}%`);
  const glare = useMotionTemplate`radial-gradient(60% 45% at ${glareX} ${glareY}, rgba(255,255,255,0.38), rgba(255,255,255,0) 70%)`;
  const foil = useMotionTemplate`linear-gradient(115deg, transparent 38%, rgba(255,120,180,0.5) 44%, rgba(255,230,140,0.5) 48%, rgba(120,255,210,0.5) 52%, rgba(120,160,255,0.5) 56%, transparent 62%) ${foilShift} 50% / 260% 260%`;

  // параллакс слоёв: CSS-переменные для .holo-layer внутри
  useMotionValueEvent(sx, 'change', (v) => ref.current?.style.setProperty('--tilt-x', v.toFixed(3)));
  useMotionValueEvent(sy, 'change', (v) => ref.current?.style.setProperty('--tilt-y', v.toFixed(3)));

  const input = useRef<'none' | 'pointer' | 'gyro'>('none');

  // гироскоп
  useEffect(() => {
    if (disabled) return;
    let base: { beta: number; gamma: number } | null = null;
    const onOrient = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null || input.current === 'pointer') return;
      base ??= { beta: event.beta, gamma: event.gamma };
      input.current = 'gyro';
      tx.set(Math.max(-1, Math.min(1, (event.gamma - base.gamma) / 25)));
      ty.set(Math.max(-1, Math.min(1, (event.beta - base.beta) / 25)));
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [disabled, tx, ty]);

  // «дыхание» без ввода
  useEffect(() => {
    if (disabled || !idle) return;
    let frame = 0;
    const start = performance.now();
    const loop = (now: number) => {
      if (input.current === 'none') {
        const s = (now - start) / 1000;
        tx.set(Math.sin(s * 0.7) * 0.35);
        ty.set(Math.sin(s * 0.9 + 1) * 0.25);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [disabled, idle, tx, ty]);

  const onPointer = (event: React.PointerEvent) => {
    if (disabled) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    input.current = 'pointer';
    tx.set(Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)));
    ty.set(Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)));
  };
  const onLeave = () => {
    if (input.current !== 'pointer') return;
    input.current = 'none';
    tx.set(0);
    ty.set(0);
  };
  const askGyro = () => {
    // iOS разрешает гироскоп только после жеста пользователя
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (D?.requestPermission) void D.requestPermission().catch(() => undefined);
  };

  return (
    <div className={cx('relative', className)} style={{ width, height: width * 1.5, perspective: 900 }}>
      <motion.div
        ref={ref}
        className="relative h-full w-full"
        style={{ rotateX: disabled ? 0 : rotateX, rotateY: disabled ? 0 : rotateY, transformStyle: 'preserve-3d' }}
        onPointerMove={onPointer}
        onPointerDown={(e) => {
          askGyro();
          onPointer(e);
        }}
        onPointerLeave={onLeave}
        onPointerUp={onLeave}
      >
        {children}
        {!disabled ? (
          <>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-screen"
              style={{ borderRadius: Math.max(8, width * 0.08), background: foil, opacity: 0.14 }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-soft-light"
              style={{ borderRadius: Math.max(8, width * 0.08), background: glare }}
            />
          </>
        ) : null}
      </motion.div>
    </div>
  );
}
