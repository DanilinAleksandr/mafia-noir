/**
 * Токены дизайн-системы для кода. CSS-сторона тех же значений — в src/styles.css (@theme).
 * Здесь — то, что нужно вычислять в JS: цвета команд для процедурных карточек, длительности анимаций.
 */
import type { Team } from '@mafia/engine';

export interface TeamPalette {
  /** Основной цвет команды. */
  primary: string;
  /** Тёмный тон для фона карточки. */
  deep: string;
  /** Цвет орнамента и рамки. */
  trim: string;
  /** Цвет текста на карточке. */
  ink: string;
}

export const TEAM_PALETTE: Record<Team, TeamPalette> = {
  red: { primary: '#e2303f', deep: '#3d070e', trim: '#f2b8a0', ink: '#fff1ea' },
  black: { primary: '#141414', deep: '#050505', trim: '#d6b25a', ink: '#f5e6bb' },
  neutral: { primary: '#2f9e7b', deep: '#0b231d', trim: '#c4ccd4', ink: '#ecf4f1' },
};

/** Классы Tailwind для меток команд. */
export const TEAM_CLASS: Record<Team, string> = {
  red: 'text-team-red border-team-red/40 bg-team-red/10',
  black: 'text-team-black-gold border-team-black-gold/40 bg-black/60',
  neutral: 'text-team-neutral border-team-neutral-emerald/50 bg-team-neutral-emerald/12',
};

export const MOTION = {
  /** Переворот карточки роли. */
  flip: { duration: 0.55, ease: [0.22, 0.8, 0.2, 1] as const },
  /** Появление экрана. */
  enter: { duration: 0.35, ease: [0.22, 0.8, 0.2, 1] as const },
  /** Задержка между строками отчёта. */
  stagger: 0.12,
};
