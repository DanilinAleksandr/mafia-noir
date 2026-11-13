/**
 * Предметы утренних сцен — векторные, без чужих ассетов. Убийцы среди них нет и быть не может:
 * только предметы и эффекты (пуля из-за кадра, нож, КАМАЗ без водителя, рояль, кирпич, яд, взрыв).
 */
import type { CSSProperties } from 'react';

type P = { className?: string; style?: CSSProperties; width?: number };

export const Syringe = ({ className, style, width = 150 }: P) => (
  <svg viewBox="0 0 150 40" width={width} className={className} style={style} aria-hidden>
    <rect x="4" y="16" width="8" height="8" rx="2" fill="#c9cfd6" />
    <rect className="plunger" x="10" y="18" width="34" height="4" fill="#aab3bd" style={{ transformOrigin: '10px 20px' }} />
    <rect x="42" y="10" width="62" height="20" rx="4" fill="rgba(210,235,255,0.35)" stroke="#e9f2ff" strokeWidth="1.5" />
    <rect x="44" y="12" width="40" height="16" rx="3" fill="#57d39a" opacity="0.85" />
    {[54, 64, 74, 84, 94].map((x) => (
      <line key={x} x1={x} y1="10" x2={x} y2="15" stroke="#e9f2ff" strokeWidth="1" />
    ))}
    <rect x="104" y="17" width="10" height="6" fill="#c9cfd6" />
    <line x1="114" y1="20" x2="148" y2="20" stroke="#e9eef3" strokeWidth="1.6" />
  </svg>
);

export const Plaster = ({ className, style, width = 120 }: P) => (
  <svg viewBox="0 0 120 44" width={width} className={className} style={style} aria-hidden>
    <rect x="1" y="1" width="118" height="42" rx="20" fill="#e6c19a" stroke="#b78d63" strokeWidth="1.2" />
    <rect x="40" y="6" width="40" height="32" rx="6" fill="#f3dcc0" />
    {[48, 56, 64, 72].map((x) => [12, 20, 28].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="#c9a07a" />))}
    {[14, 24, 96, 106].map((x) => [14, 30].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="#c9a07a" />))}
  </svg>
);

export const Shield = ({ className, style, width = 150 }: P) => (
  <svg viewBox="0 0 150 180" width={width} className={className} style={style} aria-hidden>
    <defs>
      <linearGradient id="shield-metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e9eef5" />
        <stop offset="45%" stopColor="#8e9aab" />
        <stop offset="100%" stopColor="#4a5566" />
      </linearGradient>
    </defs>
    <path d="M75 6 L140 26 L136 92 C130 132 106 160 75 174 C44 160 20 132 14 92 L10 26 Z" fill="url(#shield-metal)" stroke="#f6f9ff" strokeWidth="3" />
    <path d="M75 22 L124 37 L121 90 C116 122 98 144 75 156 C52 144 34 122 29 90 L26 37 Z" fill="none" stroke="#d6b25a" strokeWidth="3" />
    <g className="cracks" stroke="#1d2430" strokeWidth="2.4" fill="none" strokeLinecap="round">
      <path d="M78 78 L60 52 L66 38 M78 78 L104 64 L118 70 M78 78 L92 108 L84 128 M78 78 L52 96 L40 92" />
    </g>
  </svg>
);

export const Kiss = ({ className, style, width = 110 }: P) => (
  <svg viewBox="0 0 110 70" width={width} className={className} style={style} aria-hidden>
    <path
      d="M6 34 C18 14 36 10 46 22 C50 14 60 14 64 22 C74 10 92 14 104 34 C92 40 82 44 74 44 C84 50 70 64 55 64 C40 64 26 50 36 44 C28 44 18 40 6 34 Z"
      fill="#c0153a"
      opacity="0.92"
    />
    <path d="M14 34 C30 30 44 34 55 36 C66 34 80 30 96 34" stroke="#7a0a22" strokeWidth="2" fill="none" />
    <path d="M30 28 C34 24 38 24 42 26 M68 26 C72 24 76 24 80 28" stroke="#ff7d97" strokeWidth="2" fill="none" opacity="0.6" />
  </svg>
);

export const ArrowHeart = ({ className, style, width = 170 }: P) => (
  <svg viewBox="0 0 170 90" width={width} className={className} style={style} aria-hidden>
    <path d="M85 80 L52 50 C36 34 48 10 68 18 C76 21 82 28 85 34 C88 28 94 21 102 18 C122 10 134 34 118 50 Z" fill="#e2304f" stroke="#ffc2cf" strokeWidth="2" />
    <line x1="6" y1="70" x2="160" y2="16" stroke="#e9d9b0" strokeWidth="3" />
    <path d="M160 16 L146 16 L152 28 Z" fill="#e9d9b0" />
    <path d="M6 70 L16 62 M10 74 L20 66 M14 78 L24 70" stroke="#e9d9b0" strokeWidth="2.5" />
  </svg>
);

export const Tape = ({ className, style, width = 170 }: P) => (
  <svg viewBox="0 0 170 34" width={width} className={className} style={style} aria-hidden>
    <path d="M2 4 L168 2 L166 30 L4 32 L8 18 Z" fill="#d8d2c2" stroke="#9e9787" strokeWidth="1" />
    <path d="M2 4 L6 10 L2 16 L6 22 L4 32" fill="none" stroke="#9e9787" strokeWidth="1" />
    <path d="M168 2 L163 9 L168 16 L163 23 L166 30" fill="none" stroke="#9e9787" strokeWidth="1" />
  </svg>
);

export const Knife = ({ className, style, width = 150 }: P) => (
  <svg viewBox="0 0 150 34" width={width} className={className} style={style} aria-hidden>
    <path d="M58 12 L146 14 C140 22 120 26 58 24 Z" fill="#dfe6ee" stroke="#ffffff" strokeWidth="1" />
    <path d="M60 18 L140 18" stroke="#9aa7b6" strokeWidth="1" />
    <rect x="50" y="8" width="8" height="20" rx="2" fill="#b8913a" />
    <rect x="4" y="11" width="48" height="14" rx="6" fill="#3a2316" stroke="#160b05" strokeWidth="1.2" />
    {[16, 28, 40].map((x) => (
      <circle key={x} cx={x} cy="18" r="1.8" fill="#d4ad4f" />
    ))}
  </svg>
);

/** КАМАЗ — кабина без водителя: в лобовом стекле пусто. */
export const Truck = ({ className, style, width = 300 }: P) => (
  <svg viewBox="0 0 300 160" width={width} className={className} style={{ ...style }} aria-hidden>
    <g transform="translate(300 0) scale(-1 1)">
    <rect x="96" y="22" width="196" height="96" rx="4" fill="#4b5a3e" stroke="#26301f" strokeWidth="3" />
    <path d="M96 30 L96 118 L12 118 L12 76 L34 34 C38 28 44 24 52 24 L96 24 Z" fill="#e2671d" stroke="#7a330b" strokeWidth="3" />
    {/* лобовое стекло — пустое */}
    <path d="M40 40 L86 40 L86 72 L22 72 Z" fill="#9fc4de" opacity="0.75" stroke="#2b3a46" strokeWidth="2" />
    <path d="M30 66 L52 44" stroke="#ffffff" strokeWidth="3" opacity="0.5" />
    <rect x="12" y="96" width="30" height="10" fill="#f6e7a3" />
    <rect x="12" y="84" width="84" height="6" fill="#7a330b" />
    {[56, 196, 248].map((x) => (
      <g key={x}>
        <circle cx={x} cy="126" r="22" fill="#161616" />
        <circle cx={x} cy="126" r="9" fill="#9a9a9a" />
      </g>
    ))}
    </g>
    <text x="244" y="114" fontSize="11" fontWeight="700" fill="#fff4e0" fontFamily="sans-serif" textAnchor="middle">КАМАЗ</text>
    {/* фары горят */}
    <path d="M288 96 L300 90 L300 112 L288 106 Z" fill="#fff6c8" opacity="0.9" />
  </svg>
);

export const Piano = ({ className, style, width = 220 }: P) => (
  <svg viewBox="0 0 220 170" width={width} className={className} style={style} aria-hidden>
    <path d="M10 60 C10 20 60 8 110 8 L200 8 C210 8 214 14 214 24 L214 110 L10 110 Z" fill="#111" stroke="#3a3a3a" strokeWidth="3" />
    <rect x="10" y="100" width="204" height="26" fill="#f2efe6" stroke="#333" strokeWidth="2" />
    {Array.from({ length: 16 }, (_, i) => (
      <rect key={i} x={18 + i * 12.4} y="100" width="7" height="16" fill="#111" />
    ))}
    <rect x="24" y="126" width="10" height="40" fill="#111" />
    <rect x="190" y="126" width="10" height="40" fill="#111" />
  </svg>
);

export const Brick = ({ className, style, width = 120 }: P) => (
  <svg viewBox="0 0 120 56" width={width} className={className} style={style} aria-hidden>
    <rect x="2" y="2" width="116" height="52" rx="4" fill="#a3442a" stroke="#5d200f" strokeWidth="3" />
    <path d="M10 12 L40 14 M70 40 L104 42 M24 34 L48 30" stroke="#d27757" strokeWidth="2" opacity="0.6" />
    {[[30, 20], [80, 18], [60, 34], [96, 30]].map(([x, y]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#5d200f" opacity="0.5" />
    ))}
  </svg>
);

/** Потёки от места удара: пятно и несколько тонких стекающих струек (стилизованно, без натурализма). */
export const Drips = ({ className, style, width = 90, color }: P & { color: string }) => (
  <svg viewBox="0 0 90 200" width={width} className={className} style={{ transformOrigin: 'top', ...style }} aria-hidden>
    <path d="M45 6 C60 4 70 14 66 24 C76 26 74 40 62 38 C60 48 46 46 44 38 C32 44 22 36 28 28 C18 22 26 8 36 12 C38 6 42 6 45 6 Z" fill={color} />
    {[
      [36, 120, 3.2],
      [47, 170, 4.2],
      [58, 96, 2.6],
      [30, 70, 2.2],
    ].map(([x, h, w]) => (
      <g key={x}>
        <path d={`M${(x as number) - (w as number)} 30 L${(x as number) + (w as number)} 30 L${(x as number) + (w as number) * 0.6} ${h} L${(x as number) - (w as number) * 0.6} ${h} Z`} fill={color} />
        <circle cx={x} cy={(h as number) + (w as number) * 0.9} r={(w as number) * 1.25} fill={color} />
      </g>
    ))}
    <path d="M40 14 C44 12 50 13 52 16" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" fill="none" />
  </svg>
);

/** Пулевое отверстие с трещинами. */
export const BulletHole = ({ className, style, width = 90 }: P) => (
  <svg viewBox="0 0 90 90" width={width} className={className} style={style} aria-hidden>
    <g stroke="#e8e3d6" strokeWidth="1.6" fill="none" opacity="0.85">
      <path d="M45 45 L18 22 M45 45 L76 18 M45 45 L84 56 M45 45 L60 86 M45 45 L10 64 M45 45 L32 6" />
    </g>
    <circle cx="45" cy="45" r="12" fill="#0b0607" stroke="#3a2a22" strokeWidth="3" />
    <circle cx="45" cy="45" r="5" fill="#000" />
  </svg>
);

export const Folder = ({ className, style, width = 260, children }: P & { children?: React.ReactNode }) => (
  <div className={className} style={{ width, ...style }}>
    <svg viewBox="0 0 260 190" width={width} aria-hidden className="absolute inset-0">
      <path d="M6 22 L90 22 L104 8 L254 8 L254 184 L6 184 Z" fill="#c6a46a" stroke="#7d6232" strokeWidth="2" />
      <rect x="14" y="30" width="232" height="146" fill="#efe3c6" stroke="#b39a68" />
      {[78, 96, 114, 132, 150].map((y) => (
        <line key={y} x1="120" y1={y} x2="232" y2={y} stroke="#c9b48a" strokeWidth="1" />
      ))}
    </svg>
    <div className="relative" style={{ height: (width * 190) / 260 }}>
      {children}
    </div>
  </div>
);

export const Newspaper = ({ className, style, width = 280, headline, names }: P & { headline: string; names: string }) => (
  <div className={className} style={{ width, ...style }}>
    <div className="rounded-sm border border-[#7a7466] bg-[#efe9da] px-3 pt-2 pb-3 text-[#1d1a14] shadow-[0_20px_40px_-10px_black]">
      <div className="flex items-baseline justify-between border-b-2 border-[#1d1a14] pb-1">
        <span className="font-display text-[22px] leading-none font-bold">Ночной вестник</span>
        <span className="text-[9px] tracking-widest uppercase">экстренный выпуск</span>
      </div>
      <p className="mt-2 font-display text-[26px] leading-[1.02] font-bold uppercase">{headline}</p>
      <p className="mt-1 text-[13px] font-semibold">{names}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="block h-1.5 rounded bg-[#1d1a14]/25" />
        ))}
      </div>
    </div>
  </div>
);

export const Footprint = ({ className, style, width = 26, flip = false }: P & { flip?: boolean }) => (
  <svg viewBox="0 0 26 44" width={width} className={className} style={{ transform: flip ? 'scaleX(-1)' : undefined, ...style }} aria-hidden>
    <ellipse cx="13" cy="28" rx="9" ry="13" fill="currentColor" />
    {[4, 9, 14, 19].map((x, i) => (
      <circle key={x} cx={x + 2} cy={8 - (i === 1 || i === 2 ? 2 : 0)} r={i === 0 ? 3.4 : 2.6} fill="currentColor" />
    ))}
  </svg>
);

export const Skyline = ({ className, style }: P) => (
  <svg viewBox="0 0 400 120" preserveAspectRatio="none" className={className} style={style} aria-hidden>
    <path
      d="M0 120 L0 70 L20 70 L20 50 L34 50 L34 64 L52 64 L52 30 L60 22 L68 30 L68 64 L90 64 L90 44 L110 44 L110 76 L128 76 L128 36 L146 36 L146 12 L152 6 L158 12 L158 36 L176 36 L176 68 L196 68 L196 48 L214 48 L214 58 L236 58 L236 26 L254 26 L254 70 L270 70 L270 40 L300 40 L300 62 L318 62 L318 18 L326 10 L334 18 L334 62 L356 62 L356 46 L378 46 L378 72 L400 72 L400 120 Z"
      fill="#0a0708"
    />
    {[[60, 40], [150, 24], [244, 40], [326, 30], [100, 56], [290, 52]].map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width="3" height="4" fill="#f2c96a" opacity="0.8" />
    ))}
  </svg>
);

export const Bird = ({ className, style, width = 26 }: P) => (
  <svg viewBox="0 0 26 12" width={width} className={className} style={style} aria-hidden>
    <path d="M1 6 Q7 0 13 6 Q19 0 25 6" fill="none" stroke="#1a1214" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
