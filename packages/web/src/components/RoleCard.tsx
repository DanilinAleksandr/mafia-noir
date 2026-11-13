/**
 * Карточка роли (пропорции 2:3).
 *
 * Иллюстрация — `src/assets/cards/<roleId>.webp` (1024×1536, без рамки и текста), рубашка —
 * `src/assets/cards/back.webp`. Рамку в стиле ар-деко, табличку с названием и свечение в цвете
 * команды рисует код — поверх иллюстрации или процедурной заглушки (гильош, лучи, медальон
 * с эмблемой роли). Список файлов известен при сборке: отсутствующие не запрашиваются.
 */
import type { RoleId, Team } from '@mafia/engine';
import { motion } from 'framer-motion';
import { useId } from 'react';
import { t } from '../i18n';
import { MOTION, TEAM_PALETTE, type TeamPalette } from '../theme/tokens';
import { RoleEmblem } from './RoleEmblem';
import { cx } from './ui';

const ART: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/cards/*.webp', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.replace(/^.*\/([^/]+)\.webp$/, '$1'), url]),
);

export function roleArt(role: RoleId): string | null {
  return ART[role] ?? null;
}

export function backArt(): string | null {
  return ART.back ?? null;
}

interface RoleCardProps {
  role: RoleId | null;
  team: Team | null;
  /** Лицом вверх (иначе — рубашка). */
  faceUp: boolean;
  /** Ширина в пикселях; высота — ×1.5. */
  width?: number;
  /** Показывать краткое описание на табличке. */
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
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <CardBack width={width} />
        </div>
        <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}>
          {role && team ? <CardFace role={role} team={team} width={width} detailed={detailed} /> : <CardBack width={width} />}
        </div>
      </motion.div>
    </div>
  );
}

// ───────────────────────────── рубашка ─────────────────────────────

export function CardBack({ width }: { width: number }) {
  const id = useId().replace(/:/g, '');
  const art = backArt();
  const radius = Math.max(8, width * 0.08);
  return (
    <div
      data-testid="card-back"
      className="absolute inset-0 overflow-hidden border border-gold-500/60 bg-[#120d10]"
      style={{ borderRadius: radius, boxShadow: 'var(--shadow-card)' }}
    >
      {art ? <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} /> : null}
      <svg viewBox="0 0 200 300" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#6b1526" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#24090f" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0d080a" />
          </radialGradient>
          <pattern id={`${id}-dia`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 7h14M7 0v14" stroke="#c9a54c" strokeOpacity="0.16" strokeWidth="0.7" />
          </pattern>
        </defs>
        {!art ? (
          <>
            <rect width="200" height="300" fill={`url(#${id}-glow)`} />
            <rect width="200" height="300" fill={`url(#${id}-dia)`} />
            {/* лучи ар-деко из центра */}
            <g stroke="#d4ad4f" strokeOpacity="0.22" strokeWidth="0.6">
              {Array.from({ length: 36 }, (_, i) => {
                const a = (i / 36) * Math.PI * 2;
                return <line key={i} x1={100 + Math.cos(a) * 52} y1={150 + Math.sin(a) * 52} x2={100 + Math.cos(a) * 140} y2={150 + Math.sin(a) * 140} />;
              })}
            </g>
          </>
        ) : null}
        <rect x="8" y="8" width="184" height="284" rx="11" fill="none" stroke="#d4ad4f" strokeWidth="1.4" />
        <rect x="14" y="14" width="172" height="272" rx="8" fill="none" stroke="#d4ad4f" strokeOpacity="0.45" strokeWidth="0.7" />
        <DecoCorners color="#d4ad4f" />
        {!art ? (
          <>
            <circle cx="100" cy="150" r="44" fill="#0c0709" stroke="#d4ad4f" strokeWidth="1.6" />
            <circle cx="100" cy="150" r="38" fill="none" stroke="#d4ad4f" strokeOpacity="0.45" strokeWidth="0.8" />
            <path d="M100 98 L104 104 L100 110 L96 104 Z M100 190 L104 196 L100 202 L96 196 Z" fill="#d4ad4f" />
            <text x="100" y="166" textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontSize="46" fontWeight="700" fill="#e5c878">
              М
            </text>
          </>
        ) : null}
      </svg>
      <span className="sr-only">Рубашка карты</span>
    </div>
  );
}

/** Уголки ар-деко: веер из дуг и ромб. */
function DecoCorners({ color }: { color: string }) {
  const corner = (
    <g>
      <path d="M14 46 L14 14 L46 14" fill="none" stroke={color} strokeWidth="1.2" />
      <path d="M20 40 Q20 20 40 20" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
      <path d="M26 34 Q26 26 34 26" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="0.8" />
      <path d="M14 14 L19 19" stroke={color} strokeWidth="1" />
      <path d="M14 9 L19 14 L14 19 L9 14 Z" fill={color} />
    </g>
  );
  return (
    <g>
      {corner}
      <g transform="translate(200 0) scale(-1 1)">{corner}</g>
      <g transform="translate(0 300) scale(1 -1)">{corner}</g>
      <g transform="translate(200 300) scale(-1 -1)">{corner}</g>
    </g>
  );
}

// ───────────────────────────── лицо ─────────────────────────────

/** Процедурная иллюстрация: гильош, лучи и медальон с эмблемой в цвете команды. */
function ProceduralArt({ role, palette, id }: { role: RoleId; palette: TeamPalette; id: string }) {
  return (
    <svg viewBox="0 0 200 300" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor={palette.primary} stopOpacity="0.85" />
          <stop offset="45%" stopColor={palette.deep} />
          <stop offset="100%" stopColor="#040304" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.trim} stopOpacity="0.45" />
          <stop offset="70%" stopColor={palette.trim} stopOpacity="0.06" />
          <stop offset="100%" stopColor={palette.trim} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="300" fill={`url(#${id}-bg)`} />
      {/* гильош: эллипсы, повёрнутые вокруг центра */}
      <g fill="none" stroke={palette.trim} strokeOpacity="0.13" strokeWidth="0.5" transform="translate(100 118)">
        {Array.from({ length: 30 }, (_, i) => (
          <ellipse key={i} rx="78" ry="30" transform={`rotate(${i * 6})`} />
        ))}
      </g>
      <g stroke={palette.trim} strokeOpacity="0.16" strokeWidth="0.6">
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return <line key={i} x1={100 + Math.cos(a) * 62} y1={118 + Math.sin(a) * 62} x2={100 + Math.cos(a) * 200} y2={118 + Math.sin(a) * 200} />;
        })}
      </g>
      <circle cx="100" cy="118" r="72" fill={`url(#${id}-halo)`} />
      <circle cx="100" cy="118" r="50" fill={palette.deep} fillOpacity="0.85" stroke={palette.trim} strokeWidth="1.3" />
      <circle cx="100" cy="118" r="44" fill="none" stroke={palette.trim} strokeOpacity="0.4" strokeWidth="0.7" strokeDasharray="1.5 2.5" />
      {/* звёздочки по кругу медальона */}
      {[0, 90, 180, 270].map((deg) => (
        <path key={deg} d="M100 64 L102.5 68 L100 72 L97.5 68 Z" fill={palette.trim} transform={`rotate(${deg} 100 118)`} />
      ))}
    </svg>
  );
}

export function CardFace({ role, team, width, detailed = false }: { role: RoleId; team: Team; width: number; detailed?: boolean }) {
  const id = useId().replace(/:/g, '');
  const palette = TEAM_PALETTE[team];
  const art = roleArt(role);
  const text = t.roles[role];
  const radius = Math.max(8, width * 0.08);

  if (width < 80) {
    // миниатюра: только эмблема в цвете команды
    return (
      <div
        data-testid="card-face"
        data-role={role}
        title={text.name}
        className="absolute inset-0 flex items-center justify-center overflow-hidden border"
        style={{
          borderRadius: radius,
          borderColor: palette.trim,
          background: art ? undefined : `radial-gradient(120% 80% at 50% 30%, ${palette.primary}66 0%, ${palette.deep} 70%)`,
          color: palette.ink,
        }}
      >
        {art ? <img src={art} alt="" className="h-full w-full object-cover" draggable={false} /> : <RoleEmblem role={role} size={Math.round(width * 0.55)} />}
      </div>
    );
  }

  const nameSize = Math.max(14, Math.round(width * (text.name.length > 11 ? 0.095 : 0.115)));
  return (
    <div
      data-testid="card-face"
      data-role={role}
      className="absolute inset-0 overflow-hidden border"
      style={{
        borderRadius: radius,
        borderColor: palette.trim,
        color: palette.ink,
        boxShadow: `var(--shadow-card), 0 0 ${Math.round(width * 0.25)}px -${Math.round(width * 0.08)}px ${palette.primary}`,
      }}
    >
      {/* слой иллюстрации (с лёгким параллаксом в голограмме) */}
      <div className="holo-layer absolute -inset-[4%]" style={{ ['--depth' as string]: '-6px' }}>
        {art ? <img src={art} alt="" className="h-full w-full object-cover" draggable={false} /> : <ProceduralArt role={role} palette={palette} id={id} />}
      </div>
      {!art ? (
        <div
          className="holo-layer absolute inset-x-0 flex justify-center"
          style={{ top: width * 0.22, ['--depth' as string]: '10px', color: palette.ink }}
        >
          <RoleEmblem
            role={role}
            size={Math.round(width * 0.3)}
            className="drop-shadow-[0_0_10px_rgba(255,255,255,0.25)]"
          />
        </div>
      ) : null}
      {/* рамка — всегда кодом */}
      <svg viewBox="0 0 200 300" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
        <rect x="6" y="6" width="188" height="288" rx="11" fill="none" stroke={palette.trim} strokeOpacity="0.9" strokeWidth="1.3" />
        <rect x="12" y="12" width="176" height="276" rx="8" fill="none" stroke={palette.trim} strokeOpacity="0.35" strokeWidth="0.7" />
        <DecoCorners color={palette.trim} />
        {/* табличка под название */}
        <path d="M12 222 L188 222 L188 288 Q188 288 180 288 L20 288 Q12 288 12 280 Z" fill={`url(#${id}-plate)`} />
        <defs>
          <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="35%" stopColor="#000" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path d="M40 230 L92 230 L100 224 L108 230 L160 230" fill="none" stroke={palette.trim} strokeOpacity="0.8" strokeWidth="0.9" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 px-3 text-center" style={{ paddingBottom: width * 0.075 }}>
        <div className="font-bold uppercase opacity-85" style={{ color: palette.trim, fontSize: Math.max(9, width * 0.045), letterSpacing: '0.24em' }}>
          {t.teams[team].name}
        </div>
        <div className="font-display leading-[1.05] font-bold" style={{ fontSize: nameSize, textShadow: `0 0 18px ${palette.primary}` }}>
          {text.name}
        </div>
        {detailed && width >= 170 ? (
          <p className="mx-auto mt-1 max-w-[88%] leading-snug opacity-80" style={{ fontSize: Math.max(11, width * 0.052) }}>
            {text.short}
          </p>
        ) : null}
      </div>
    </div>
  );
}
