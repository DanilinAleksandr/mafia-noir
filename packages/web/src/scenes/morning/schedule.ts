/**
 * Расписание утренней сцены: когда что начинается (с). Одно и то же расписание читают
 * таймлайн GSAP и частицы на canvas — поэтому они всегда совпадают.
 */
import type { MorningPlan, PersonalItem } from './plan';
import { MAX_PERSONAL } from './plan';

export interface Slot {
  at: number;
  duration: number;
}

export interface Schedule {
  wake: Slot;
  personal: Slot[];
  publicAt: number;
  sky: Slot;
  deaths: Slot[];
  quiet: Slot | null;
  extras: Slot | null;
  summaryAt: number;
  total: number;
}

export function episodeDuration(item: PersonalItem): number {
  switch (item.kind) {
    case 'death':
      return 2.8;
    case 'dossier':
    case 'newspaper':
    case 'footprints':
      return 2.5;
    default:
      return 2.2;
  }
}

export function schedule(plan: MorningPlan, reduced: boolean): Schedule {
  const k = reduced ? 0.45 : 1;
  const wake: Slot = { at: 0, duration: 1.3 * k };
  let t = wake.at + wake.duration;
  const personal: Slot[] = [];
  for (const item of plan.personal.slice(0, MAX_PERSONAL)) {
    const duration = episodeDuration(item) * k;
    personal.push({ at: t, duration });
    t += duration;
  }
  const publicAt = t;
  const sky: Slot = { at: t, duration: 1.4 * k };
  t += sky.duration;
  const deaths: Slot[] = [];
  const shown = plan.public.filter((p) => p.kind === 'death').slice(0, 3);
  for (const d of shown) {
    const duration = (d.kind === 'death' && d.with ? 1.9 : 1.6) * k;
    deaths.push({ at: t, duration });
    t += duration;
  }
  let quiet: Slot | null = null;
  if (plan.quiet) {
    quiet = { at: t - 0.6 * k, duration: 2.2 * k };
    t = quiet.at + quiet.duration;
  }
  const hasExtras = plan.public.some((p) => p.kind === 'saved' || p.kind === 'silenced');
  const extras: Slot | null = hasExtras ? { at: t, duration: 1 * k } : null;
  if (extras) t += extras.duration;
  const summaryAt = t + 0.1;
  return { wake, personal, publicAt, sky, deaths, quiet, extras, summaryAt, total: summaryAt + 0.5 };
}
