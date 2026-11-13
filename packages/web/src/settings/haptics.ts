/**
 * Вибрация на ключевых моментах. Только если она включена в настройках и есть в браузере.
 */
import { getPrefs } from './prefs';

export const HAPTIC = {
  tap: 12,
  flip: [18, 40, 30],
  impact: [60, 30, 90],
  stamp: [40, 20, 70],
  notify: [25, 60, 25],
} as const satisfies Record<string, number | readonly number[]>;

export function vibrate(pattern: keyof typeof HAPTIC | number | readonly number[]): void {
  if (!getPrefs().vibration || typeof navigator.vibrate !== 'function') return;
  const value = typeof pattern === 'string' ? HAPTIC[pattern] : pattern;
  try {
    navigator.vibrate(value as number | number[]);
  } catch {
    // некоторые браузеры бросают, если вибрация запрещена
  }
}
