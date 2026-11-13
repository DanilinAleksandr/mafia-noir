/**
 * Личные настройки устройства (не комнаты): звук, вибрация, уменьшение анимации, мягкие эффекты.
 * Хранятся в localStorage. Качество эффектов выбирается само: на слабых устройствах и при
 * системном «уменьшить движение» сцены упрощаются; если во время сцены кадры проседают,
 * качество понижается до конца сессии.
 */
import { useSyncExternalStore } from 'react';

export interface Prefs {
  sound: boolean;
  vibration: boolean;
  /** Упрощённые сцены: без полётов и частиц, короткие переходы. */
  reduceMotion: boolean;
  /** Без крови: вместо неё чернила, дым, ткань. */
  softEffects: boolean;
}

/** Уровень эффектов: full — всё; lite — меньше частиц, без размытия; reduced — только простые переходы. */
export type Quality = 'full' | 'lite' | 'reduced';

const KEY = 'mafia.prefs';

function systemReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function defaults(): Prefs {
  return { sound: true, vibration: true, reduceMotion: systemReducedMotion(), softEffects: false };
}

function load(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    return { ...defaults(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaults();
  }
}

let prefs: Prefs = load();
/** Понижение качества, замеченное во время игры (до перезагрузки страницы). */
let runtimeLite = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // без сохранения
  }
  emit();
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);
}

/** Слабое устройство: мало ядер или памяти. */
export function weakDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  return cores <= 4 || memory <= 3;
}

export function quality(p: Prefs = prefs): Quality {
  if (p.reduceMotion) return 'reduced';
  if (runtimeLite || weakDevice()) return 'lite';
  return 'full';
}

/** Сцена заметила просадку кадров — дальше играем в облегчённом режиме. */
export function downgradeQuality(): void {
  if (runtimeLite) return;
  runtimeLite = true;
  emit();
}

/** Для тестов. */
export function resetPrefs(): void {
  prefs = load();
  runtimeLite = false;
  emit();
}
