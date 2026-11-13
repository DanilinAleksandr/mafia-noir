/**
 * Эмблемы ролей для процедурных карточек — простые линейные знаки (24×24).
 * Когда появятся иллюстрации (src/assets/cards/<roleId>.webp), эмблема останется для мелких мест.
 */
import type { RoleId } from '@mafia/engine';

const PATHS: Record<RoleId, string> = {
  commissioner: 'M12 2l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 15.8 6.7 18.6l1.1-6L3.4 8.4l6-.8z',
  detective: 'M10.5 3a7.5 7.5 0 105.3 12.8L21 21M10.5 6.5a4 4 0 00-4 4',
  patrol: 'M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12zM12 9a3 3 0 110 6 3 3 0 010-6z',
  journalist: 'M4 20l3.5-1 11-11a2.1 2.1 0 00-3-3l-11 11L4 20zM14 6.5l3 3M4 20h16',
  hobo: 'M9 2h6M10 2v4l-3 4v10a2 2 0 002 2h6a2 2 0 002-2V10l-3-4V2M7 13h10',
  doctor: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  bodyguard: 'M12 2l8 3v6c0 5.5-3.5 9.5-8 11-4.5-1.5-8-5.5-8-11V5zM12 7v9M8.5 11h7',
  priest: 'M12 2v20M7 7.5h10M9 22h6',
  hero: 'M14.5 3.5L20 2l-1.5 5.5L8 18l-2-2zM4 16l4 4M3 21l2-2M11.5 6.5l6 6',
  witch: 'M9 2h6M10 2v6.5L4.8 18.3A2.4 2.4 0 007 22h10a2.4 2.4 0 002.2-3.7L14 8.5V2M6.5 15h11',
  hunter: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 6a6 6 0 110 12 6 6 0 010-12zM12 11v2',
  mayor: 'M8 14a5 5 0 110-10 5 5 0 010 10zM11.5 12.5L21 22M17 18l2-2M15 16l2-2',
  judge: 'M12 3v18M7 21h10M4 7h16M4 7l-2.5 6a3 3 0 005 0zM20 7l-2.5 6a3 3 0 005 0z',
  cupid: 'M12 20.5l-7.7-7.4A5 5 0 0112 6.6a5 5 0 017.7 6.5zM2 22L10 14M2 22v-4M2 22h4M22 2l-6 6M22 2h-4M22 2v4',
  civilian: 'M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6',
  mafia: 'M3 15h18M5 15c0-4 1-9 4-9 1 0 2 1 3 1s2-1 3-1c3 0 4 5 4 9M2 15l2 3h16l2-3',
  don: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5zM5 22h14',
  lawyer: 'M3 8h18v12H3zM9 8V5a1 1 0 011-1h4a1 1 0 011 1v3M3 13h18',
  blackmailer: 'M3 5h18v14H3zM3 5l9 8 9-8M12 13v2',
  consigliere: 'M12 3a9 9 0 019 9 9 9 0 01-18 0 9 9 0 019-9zM8 10a1.5 1.5 0 100 .1M16 10a1.5 1.5 0 100 .1M8 16c2.5 2 5.5 2 8 0',
  maniac: 'M20 2L8 14l2 2L22 4zM8 14l-5 5a2 2 0 003 3l5-5M6.5 15.5l2 2',
  mistress: 'M12 21c-4-2-7-5.5-7-9.5C5 8 7.5 6 9.5 6c1.2 0 2 .7 2.5 1.5C12.5 6.7 13.3 6 14.5 6 16.5 6 19 8 19 11.5c0 4-3 7.5-7 9.5zM12 7.5V3M9 3h6',
  jester: 'M4 8c2 0 4 2 5 5l3-9 3 9c1-3 3-5 5-5l-3 12H7zM4 8a1.5 1.5 0 110-.1M20 8a1.5 1.5 0 110-.1M12 4a1.5 1.5 0 110-.1',
  survivor: 'M12 2c1 3 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',
  bomber: 'M10 8a7 7 0 110 14 7 7 0 010-14zM14.5 9.5L17 7M17 7l1.5-1.5M19 3l1 1M21.5 5.5l-1 .5M20 1.5l-.5 1',
};

export function RoleEmblem({ role, size = 24, className }: { role: RoleId; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[role]} />
    </svg>
  );
}
