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

/**
 * Процедурная иллюстрация в композиции настоящего арта: верхние ~17% свободны под название,
 * «персонаж» (медальон с эмблемой) — ниже центра, низ карточки открыт.
 */
function ProceduralArt({ palette, id }: { palette: TeamPalette; id: string }) {
  const cy = 176;
  return (
    <svg viewBox="0 0 200 300" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="58%" r="70%">
          <stop offset="0%" stopColor={palette.primary} stopOpacity="0.85" />
          <stop offset="48%" stopColor={palette.deep} />
          <stop offset="100%" stopColor="#040304" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.trim} stopOpacity="0.45" />
          <stop offset="70%" stopColor={palette.trim} stopOpacity="0.06" />
          <stop offset="100%" stopColor={palette.trim} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill={`url(#${id}-bg)`} />
      {/* гильош вокруг «персонажа» */}
      <g fill="none" stroke={palette.trim} strokeOpacity="0.13" strokeWidth="0.5" transform={`translate(100 ${cy})`}>
        {Array.from({ length: 30 }, (_, i) => (
          <ellipse key={i} rx="80" ry="31" transform={`rotate(${i * 6})`} />
        ))}
      </g>
      <g stroke={palette.trim} strokeOpacity="0.15" strokeWidth="0.6">
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return <line key={i} x1={100 + Math.cos(a) * 64} y1={cy + Math.sin(a) * 64} x2={100 + Math.cos(a) * 210} y2={cy + Math.sin(a) * 210} />;
        })}
      </g>
      <circle cx="100" cy={cy} r="74" fill={`url(#${id}-halo)`} />
      <circle cx="100" cy={cy} r="54" fill={palette.deep} fillOpacity="0.85" stroke={palette.trim} strokeWidth="1.3" />
      <circle cx="100" cy={cy} r="47" fill="none" stroke={palette.trim} strokeOpacity="0.4" strokeWidth="0.7" strokeDasharray="1.5 2.5" />
      {[0, 90, 180, 270].map((deg) => (
        <path key={deg} d={`M100 ${cy - 58} L102.5 ${cy - 54} L100 ${cy - 50} L97.5 ${cy - 54} Z`} fill={palette.trim} transform={`rotate(${deg} 100 ${cy})`} />
      ))}
      <rect y="230" width="200" height="70" fill={`url(#${id}-floor)`} />
    </svg>
  );
}

/** Кегль названия: крупно, но чтобы длинное название влезло в ширину карточки. */
function titleSize(name: string, width: number): number {
  const longest = Math.max(...name.split(' ').map((w) => w.length));
  const perLine = name.length > 9 ? Math.max(longest, Math.ceil(name.length / 2)) : name.length;
  return Math.round(Math.min(width * 0.17, (width * 0.82) / (perLine * 0.44)));
}

export function CardFace({ role, team, width }: { role: RoleId; team: Team; width: number; detailed?: boolean }) {
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

  const size = titleSize(text.name, width);
  const twoLines = text.name.includes(' ') && text.name.length > 9;
  return (
    <div
      data-testid="card-face"
      data-role={role}
      className="absolute inset-0 overflow-hidden border-2"
      style={{
        borderRadius: radius,
        borderColor: palette.trim,
        color: palette.ink,
        // цвет команды — свечением и рамкой
        boxShadow: `var(--shadow-card), 0 0 ${Math.round(width * 0.22)}px -${Math.round(width * 0.04)}px ${palette.primary}, inset 0 0 ${Math.round(width * 0.12)}px -${Math.round(width * 0.03)}px ${palette.primary}`,
      }}
    >
      {/* слой иллюстрации (с лёгким параллаксом в голограмме) */}
      <div className="holo-layer absolute -inset-[4%]" style={{ ['--depth' as string]: '-6px' }}>
        {art ? <img src={art} alt="" className="h-full w-full object-cover" draggable={false} /> : <ProceduralArt palette={palette} id={id} />}
      </div>
      {!art ? (
        <div
          className="holo-layer absolute inset-x-0 flex justify-center"
          style={{ top: width * 0.72, ['--depth' as string]: '10px', color: palette.ink }}
        >
          <RoleEmblem role={role} size={Math.round(width * 0.32)} className="drop-shadow-[0_0_10px_rgba(255,255,255,0.25)]" />
        </div>
      ) : null}
      {/* мягкое затемнение под названием — не табличка, просто чтобы читалось на любом арте */}
      <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: '24%', background: 'linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0))' }} />
      {/* рамка — всегда кодом */}
      <svg viewBox="0 0 200 300" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
        <rect x="6" y="6" width="188" height="288" rx="11" fill="none" stroke={palette.trim} strokeOpacity="0.9" strokeWidth="1.3" />
        <rect x="12" y="12" width="176" height="276" rx="8" fill="none" stroke={palette.trim} strokeOpacity="0.35" strokeWidth="0.7" />
        <DecoCorners color={palette.trim} />
      </svg>
      {/* название — сверху, над головой персонажа, рукописным шрифтом с сиянием цвета команды */}
      <div
        className="holo-layer absolute inset-x-0 top-0 flex items-center justify-center px-[9%] text-center"
        style={{ height: twoLines ? '24%' : '18%', paddingTop: width * 0.04, ['--depth' as string]: '4px' }}
      >
        <span
          className="font-hand leading-[0.9] font-bold"
          data-testid="card-title"
          style={{
            fontSize: size,
            color: palette.ink,
            textShadow: `0 0 ${Math.round(size * 0.35)}px ${palette.primary}, 0 0 ${Math.round(size * 0.12)}px ${palette.primary}, 0 2px 2px rgba(0,0,0,0.8)`,
            transform: 'rotate(-2deg)',
          }}
        >
          {text.name}
        </span>
      </div>
    </div>
  );
}
