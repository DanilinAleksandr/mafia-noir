/**
 * Детерминированный генератор случайных чисел.
 * Состояние — одно 32-битное число, хранится прямо в GameState.
 */

/** Хеш строки или числа в 32-битное начальное состояние (xmur3). */
export function seedToState(seed: string | number): number {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Один шаг mulberry32: новое состояние и число в [0, 1). */
export function rngStep(state: number): { state: number; value: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

export interface Rng {
  /** Текущее состояние (его сохраняют обратно в GameState). */
  readonly state: number;
  /** Число в [0, 1). */
  next(): number;
  /** Целое в [0, n). */
  int(n: number): number;
  /** Случайный элемент непустого массива. */
  pick<T>(items: readonly T[]): T;
  /** Перемешанная копия массива (Фишер — Йетс). */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(initial: number): Rng {
  let state = initial >>> 0;
  const next = (): number => {
    const step = rngStep(state);
    state = step.state;
    return step.value;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    get state() {
      return state;
    },
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: пустой массив');
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
  };
}
