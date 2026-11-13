/**
 * Игроки: аватар, плитки для выбора цели, строки списка.
 */
import type { PlayerId, RoleId, Team, ViewPlayer } from '@mafia/engine';
import { motion } from 'framer-motion';
import { type ReactNode, useState } from 'react';
import { roleName, t } from '../i18n';
import { TEAM_CLASS } from '../theme/tokens';
import { IconCheck, IconCrown, IconHeart, IconMute, IconSkull } from './icons';
import { cx } from './ui';

const AVATAR_TONES = [
  'from-[#6b2333] to-[#2a0c14]',
  'from-[#7a5f24] to-[#2b2010]',
  'from-[#33465f] to-[#11182a]',
  'from-[#2f5e50] to-[#0f2520]',
  'from-[#5a3a62] to-[#1f1224]',
  'from-[#6e4a2a] to-[#26180c]',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return Array.from(parts[0] as string)[0]!.toUpperCase();
  return ((parts[0] as string)[0]! + (parts[1] as string)[0]!).toUpperCase();
}

function toneOf(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length] as string;
}

export function Avatar({
  name,
  id,
  size = 40,
  dead = false,
  online,
}: {
  name: string;
  id: string;
  size?: number;
  dead?: boolean;
  online?: boolean;
}) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        className={cx(
          'flex h-full w-full items-center justify-center rounded-full border border-gold-400/30 bg-gradient-to-br font-display font-bold text-paper/90',
          toneOf(id),
          dead && 'grayscale opacity-55',
        )}
        style={{ fontSize: size * 0.38 }}
      >
        {dead ? <IconSkull size={size * 0.5} /> : initials(name)}
      </span>
      {online !== undefined ? (
        <span
          aria-label={online ? t.common.online : t.common.offline}
          className={cx(
            'absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-coal',
            online ? 'bg-ok' : 'bg-faint',
          )}
        />
      ) : null}
    </span>
  );
}

export function TeamBadge({ team, role }: { team: Team | null; role: RoleId | null }) {
  if (!role) return null;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        team ? TEAM_CLASS[team] : 'border-white/15 text-muted',
      )}
    >
      {roleName(role)}
    </span>
  );
}

/** Строка игрока в списке стола. */
export function PlayerRow({
  player,
  me,
  aside,
  note,
  host,
  revealAlive = false,
}: {
  player: ViewPlayer;
  me: boolean;
  aside?: ReactNode;
  note?: ReactNode;
  host?: boolean;
  /**
   * Показывать роли живых. По умолчанию — нет: телефон лежит на столе, и своя роль или роли
   * сообщников не должны попадаться на глаза соседям. Роли живых — в «Моей роли» по удержанию.
   */
  revealAlive?: boolean;
}) {
  return (
    <li className={cx('flex items-center gap-3 py-2', !player.alive && 'opacity-70')} data-testid="player-row">
      <Avatar name={player.name} id={player.id} dead={!player.alive} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cx('truncate text-[15px] font-semibold', !player.alive && 'line-through decoration-white/30')}>
            {player.name}
          </span>
          {me ? <span className="text-xs text-gold-300">({t.common.you})</span> : null}
          {host ? <IconCrown size={14} className="text-gold-300" /> : null}
          {player.lover ? <IconHeart size={14} className="text-team-red" aria-label={t.game.lover} /> : null}
          {player.silenced && player.alive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/8 px-1.5 text-[11px] text-muted">
              <IconMute size={12} /> {t.game.silenced}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {revealAlive || !player.alive ? <TeamBadge team={player.team} role={player.role} /> : null}
          {!player.alive && player.deathCause ? <span>{t.deathCauses[player.deathCause]}</span> : null}
          {note}
        </div>
      </div>
      {aside}
    </li>
  );
}

/** Плитки игроков для выбора цели. */
export function PlayerPicker({
  players,
  candidates,
  selected,
  max,
  onChange,
  disabled,
  marks,
  me,
  uniform = false,
}: {
  players: ViewPlayer[];
  /** Кого можно выбрать; остальные видны, но неактивны. */
  candidates: readonly PlayerId[];
  selected: readonly PlayerId[];
  max: number;
  onChange: (next: PlayerId[]) => void;
  disabled?: boolean;
  /** Подписи под плитками (голоса команды, «проголосовал»). */
  marks?: Partial<Record<PlayerId, ReactNode>>;
  me?: PlayerId | null;
  /**
   * Одинаковый вид для всех ролей (ночь): недоступные игроки не затемняются и не помечаются,
   * нажатие на них лишь слегка встряхивает плитку. Так по экрану не видно, кого нельзя выбрать.
   */
  uniform?: boolean;
}) {
  const [shake, setShake] = useState<PlayerId | null>(null);
  const toggle = (id: PlayerId) => {
    if (disabled) return;
    if (!candidates.includes(id)) {
      if (uniform) {
        setShake(id);
        setTimeout(() => setShake((s) => (s === id ? null : s)), 400);
      }
      return;
    }
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (max === 1) onChange([id]);
    else if (selected.length < max) onChange([...selected, id]);
    else onChange([...selected.slice(1), id]);
  };
  const shown = players.filter((p) => p.alive);
  return (
    <div className="grid grid-cols-3 gap-2.5" role="listbox" aria-multiselectable={max > 1}>
      {shown.map((p) => {
        const can = candidates.includes(p.id);
        const on = selected.includes(p.id);
        return (
          <motion.button
            key={p.id}
            type="button"
            role="option"
            aria-selected={on}
            aria-disabled={uniform ? undefined : !can}
            aria-label={p.name}
            whileTap={(can || uniform) && !disabled ? { scale: 0.95 } : undefined}
            animate={shake === p.id ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
            transition={{ duration: 0.35 }}
            onClick={() => toggle(p.id)}
            className={cx(
              'relative flex flex-col items-center gap-1.5 rounded-2xl border px-1.5 pt-3 pb-2.5 text-center transition',
              on ? 'border-phase-accent bg-phase-soft shadow-[0_0_0_1px_var(--phase-accent)]' : 'border-white/8 bg-black/25',
              !can && !uniform && 'opacity-35',
            )}
          >
            <Avatar name={p.name} id={p.id} size={44} />
            <span className="w-full truncate text-[13px] leading-tight font-semibold">
              {p.name}
              {me === p.id ? <span className="text-gold-300"> •</span> : null}
            </span>
            {marks?.[p.id] ? <span className="text-[11px] leading-tight text-muted">{marks[p.id]}</span> : null}
            {on ? (
              <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-phase-accent text-ink">
                <IconCheck size={13} strokeWidth={3} />
              </span>
            ) : null}
          </motion.button>
        );
      })}
    </div>
  );
}
