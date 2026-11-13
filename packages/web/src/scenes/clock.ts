/**
 * Часы сцен. Каждая сцена строит один главный таймлайн GSAP и регистрирует его здесь.
 * Через часы работают:
 *  - пропуск сцены тапом (`skip`) — переход к конечному кадру;
 *  - страница /dev/scenes — скорость (×0.25…×1), пауза, покадровая прокрутка, перемотка;
 *  - скриншоты сцен — перемотка к началу, середине и концу.
 * Частицы на canvas берут время из таймлайна, поэтому тоже замедляются и замирают вместе с ним.
 */
import type { gsap } from 'gsap';

type Timeline = gsap.core.Timeline;

export interface SceneEntry {
  timeline: Timeline;
  /** Пропуск по тапу: по умолчанию — к концу таймлайна. */
  skip?: () => void;
}

interface ClockState {
  speed: number;
  paused: boolean;
}

const state: ClockState = { speed: 1, paused: false };
let current: SceneEntry | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const sceneClock = {
  /** Зарегистрировать главный таймлайн сцены. Возвращает отмену регистрации. */
  register(entry: SceneEntry): () => void {
    current = entry;
    entry.timeline.timeScale(state.speed);
    if (state.paused) entry.timeline.pause();
    emit();
    return () => {
      if (current === entry) current = null;
      emit();
    };
  },

  get current(): SceneEntry | null {
    return current;
  },

  get speed(): number {
    return state.speed;
  },

  get paused(): boolean {
    return state.paused;
  },

  setSpeed(speed: number): void {
    state.speed = speed;
    current?.timeline.timeScale(speed);
    emit();
  },

  setPaused(paused: boolean): void {
    state.paused = paused;
    if (current) {
      if (paused) current.timeline.pause();
      else current.timeline.resume();
    }
    emit();
  },

  /** Сдвинуть на dt секунд (покадрово: 1/60), оставаясь на паузе. */
  step(dt: number): void {
    if (!current) return;
    const tl = current.timeline;
    tl.pause();
    state.paused = true;
    tl.time(Math.max(0, Math.min(tl.duration(), tl.time() + dt)), true);
    emit();
  },

  /** Перемотать к доле таймлайна (0…1) и остановиться. События не вызываются. */
  seek(progress: number): void {
    if (!current) return;
    const tl = current.timeline;
    tl.pause();
    state.paused = true;
    tl.progress(Math.max(0, Math.min(1, progress)), true);
    emit();
  },

  /** Перемотать к моменту (с) и остановиться. */
  seekTime(seconds: number): void {
    if (!current) return;
    const tl = current.timeline;
    tl.pause();
    state.paused = true;
    tl.time(Math.max(0, Math.min(tl.duration(), seconds)), true);
    emit();
  },

  skip(): void {
    if (!current) return;
    if (current.skip) current.skip();
    else current.timeline.progress(1);
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Сбросить скорость и паузу (между сценами на странице разработки). */
  reset(): void {
    state.speed = 1;
    state.paused = false;
    emit();
  },
};
