/**
 * Обратный отсчёт до конца стадии — по часам сервера (deadline − serverTime), а не по часам телефона.
 */
import { useEffect, useState } from 'react';
import { IconHourglass } from './icons';
import { cx } from './ui';

export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function secondsLeft(deadline: number, clockOffset: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - (now + clockOffset)) / 1000));
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Countdown({ deadline, clockOffset, className }: { deadline: number | null; clockOffset: number; className?: string }) {
  const now = useNow();
  if (deadline === null) return null;
  const left = secondsLeft(deadline, clockOffset, now);
  return (
    <span
      role="timer"
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums',
        left <= 10 ? 'border-danger/60 text-danger' : 'border-white/15 text-paper/90',
        className,
      )}
    >
      <IconHourglass size={14} />
      {formatClock(left)}
    </span>
  );
}
