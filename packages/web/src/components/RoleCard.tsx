/**
 * Карточка роли (пропорции 2:3).
 *
 * Лицевая сторона — иллюстрация `src/assets/cards/<roleId>.webp`, если она есть, иначе
 * процедурная заглушка в цвете команды: рамка, эмблема роли, название. Рубашка одинакова для всех.
 * Переворот — rotateY (простая анимация; полноценные сцены — этап 4).
 */
import type { RoleId, Team } from '@mafia/engine';
import { motion } from 'framer-motion';
import { t } from '../i18n';
import { MOTION, TEAM_PALETTE } from '../theme/tokens';
import { RoleEmblem } from './RoleEmblem';
import { cx } from './ui';

/** Иллюстрации, которые есть в сборке. Отсутствующие файлы не запрашиваются по сети вовсе. */
const ART: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/cards/*.webp', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.replace(/^.*\/([^/]+)\.webp$/, '$1'), url]),
);

export function roleArt(role: RoleId): string | null {
  return ART[role] ?? null;
}

interface RoleCardProps {
  role: RoleId | null;
  team: Team | null;
  /** Лицом вверх (иначе — рубашка). */
  faceUp: boolean;
  /** Ширина в пикселях; высота — ×1.5. */
  width?: number;
  /** Показывать краткое описание под названием. */
  detailed?: boolean;
  className?: string;
}

export function RoleCard({ role, team, faceUp, width = 220, detailed = false, className }: RoleCardProps) {
  const height = Math.round(width * 1.5);
  return (
    <div className={cx('relative select-none', className)} style={{ width, height, perspective: 1200 }}>
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={{ rotateY: faceUp ? 180 : 0 }}
        transition={MOTION.flip}
      >
        <CardBack width={width} />
        <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}>
          {role && team ? <CardFace role={role} team={team} width={width} detailed={detailed} /> : <CardBack width={width} />}
        </div>
      </motion.div>
    </div>
  );
}

function CardBack({ width }: { width: number }) {
  return (
    <div
      data-testid="card-back"
      className="absolute inset-0 overflow-hidden rounded-[18px] border border-gold-500/50 bg-[#120d10]"
      style={{ backfaceVisibility: 'hidden', boxShadow: 'var(--shadow-card)' }}
    >
      <svg viewBox="0 0 200 300" className="h-full w-full" aria-hidden>
        <defs>
          <pattern id="back-diamonds" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="20" height="20" fill="#160e12" />
            <path d="M0 10h20M10 0v20" stroke="#3a2a18" strokeWidth="0.8" />
          </pattern>
          <radialGradient id="back-glow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#5a1422" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#120d10" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="200" height="300" fill="url(#back-diamonds)" />
        <rect width="200" height="300" fill="url(#back-glow)" />
        <rect x="9" y="9" width="182" height="282" rx="12" fill="none" stroke="#b8913a" strokeWidth="1.2" />
        <rect x="15" y="15" width="170" height="270" rx="9" fill="none" stroke="#b8913a" strokeOpacity="0.45" strokeWidth="0.8" />
        <circle cx="100" cy="150" r="42" fill="#0d090b" stroke="#d4ad4f" strokeWidth="1.4" />
        <circle cx="100" cy="150" r="36" fill="none" stroke="#d4ad4f" strokeOpacity="0.4" strokeWidth="0.8" />
        <text
          x="100"
          y="166"
          textAnchor="middle"
          fontFamily="'Playfair Display', Georgia, serif"
          fontSize="46"
          fontWeight="700"
          fill="#e5c878"
        >
          М
        </text>
      </svg>
      <span className="sr-only">Рубашка карты</span>
    </div>
  );
}

function CardFace({ role, team, width, detailed }: { role: RoleId; team: Team; width: number; detailed: boolean }) {
  const palette = TEAM_PALETTE[team];
  const art = roleArt(role);
  const text = t.roles[role];
  const small = width < 140;
  if (width < 80) {
    // миниатюра: только эмблема в цвете команды, без текста
    return (
      <div
        data-testid="card-face"
        data-role={role}
        title={text.name}
        className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[10px] border"
        style={{
          borderColor: palette.trim,
          background: art ? undefined : `radial-gradient(120% 80% at 50% 30%, ${palette.primary}66 0%, ${palette.deep} 70%)`,
          color: palette.ink,
        }}
      >
        {art ? <img src={art} alt="" className="h-full w-full object-cover" draggable={false} /> : <RoleEmblem role={role} size={Math.round(width * 0.55)} />}
      </div>
    );
  }
  return (
    <div
      data-testid="card-face"
      data-role={role}
      className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border"
      style={{
        borderColor: palette.trim,
        background: `radial-gradient(120% 80% at 50% 25%, ${palette.primary}55 0%, ${palette.deep} 60%, #050405 100%)`,
        color: palette.ink,
        boxShadow: `var(--shadow-card), 0 0 40px -18px ${palette.primary}`,
      }}
    >
      {art ? (
        <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <svg viewBox="0 0 200 300" className="absolute inset-0 h-full w-full" aria-hidden>
          <rect x="9" y="9" width="182" height="282" rx="12" fill="none" stroke={palette.trim} strokeOpacity="0.8" strokeWidth="1.2" />
          <rect x="15" y="15" width="170" height="270" rx="9" fill="none" stroke={palette.trim} strokeOpacity="0.3" strokeWidth="0.8" />
          {[
            [15, 15],
            [185, 15],
            [15, 285],
            [185, 285],
          ].map(([x, y]) => (
            <path
              key={`${x}-${y}`}
              d={`M${x} ${(y as number) - 6} L${(x as number) + 6} ${y} L${x} ${(y as number) + 6} L${(x as number) - 6} ${y} Z`}
              fill={palette.trim}
              fillOpacity="0.8"
            />
          ))}
          <circle cx="100" cy="118" r="54" fill={palette.deep} fillOpacity="0.65" stroke={palette.trim} strokeOpacity="0.6" />
          <circle cx="100" cy="118" r="47" fill="none" stroke={palette.trim} strokeOpacity="0.25" />
        </svg>
      )}
      {!art ? (
        <div className="relative flex flex-1 items-start justify-center" style={{ paddingTop: width * 0.21 }}>
          <RoleEmblem role={role} size={Math.round(width * 0.3)} className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div
        className="relative px-3 text-center"
        style={{
          paddingBottom: small ? 8 : width * 0.08,
          background: art ? 'linear-gradient(transparent, rgba(0,0,0,0.85) 45%)' : undefined,
          paddingTop: art ? 28 : 0,
        }}
      >
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-75" style={{ color: palette.trim }}>
          {t.teams[team].name}
        </div>
        <div className="font-display leading-tight font-bold" style={{ fontSize: Math.max(13, Math.round(width * 0.11)) }}>
          {text.name}
        </div>
        {detailed && !small ? <p className="mt-1.5 text-[12px] leading-snug opacity-85">{text.short}</p> : null}
      </div>
    </div>
  );
}
