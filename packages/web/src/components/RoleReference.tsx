/**
 * Справочник ролей: все роли по командам и категориям, с описаниями. Доступен всегда.
 */
import { ROLE_LIST } from '@mafia/engine';
import type { Category, RoleId, Rules } from '@mafia/engine';
import { categoryOf, teamOf } from '@mafia/engine';
import type { RoleCount } from '@mafia/protocol';
import { useState } from 'react';
import { t } from '../i18n';
import { RoleCard } from './RoleCard';
import { cx } from './ui';

const ORDER: Category[] = ['redInfo', 'redDefense', 'redActive', 'redPlain', 'black', 'neutral'];

export function RoleReference({
  rules,
  composition,
  highlight,
}: {
  rules?: Rules;
  /** Состав партии (режимы «Открытый» и «Кино»): роли из него отмечаются. */
  composition?: RoleCount[] | null;
  /** Своя роль. */
  highlight?: RoleId | null;
}) {
  const [open, setOpen] = useState<RoleId | null>(highlight ?? null);
  const effective: Rules = rules ?? ({ mistressMode: 'neutral' } as Rules);
  const inGame = new Map((composition ?? []).map((c) => [c.role, c.count]));
  return (
    <div className="space-y-6">
      {composition ? (
        <section>
          <h3 className="mb-2 text-xs font-bold tracking-[0.18em] text-gold-300/90 uppercase">{t.game.composition}</h3>
          <div className="flex flex-wrap gap-1.5">
            {composition.map((c) => (
              <span key={c.role} className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-sm">
                {t.roles[c.role].name}
                {c.count > 1 ? <span className="text-muted"> ×{c.count}</span> : null}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {ORDER.map((category) => {
        const roles = ROLE_LIST.filter((r) => categoryOf(r.id, effective) === category);
        if (roles.length === 0) return null;
        return (
          <section key={category}>
            <h3 className="mb-2 text-xs font-bold tracking-[0.18em] text-gold-300/90 uppercase">{t.categories[category]}</h3>
            <ul className="space-y-2">
              {roles.map((r) => {
                const team = teamOf(r.id, effective);
                const expanded = open === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : r.id)}
                      className={cx(
                        'flex w-full items-start gap-3 rounded-2xl border p-2.5 text-left transition',
                        expanded ? 'border-gold-400/40 bg-white/6' : 'border-white/6 bg-black/20',
                        highlight === r.id && 'ring-1 ring-gold-300/60',
                      )}
                    >
                      <RoleCard role={r.id} team={team} faceUp width={expanded ? 104 : 48} />
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="flex items-center gap-2">
                          <span className="font-display text-lg leading-tight">{t.roles[r.id].name}</span>
                          {inGame.has(r.id) ? (
                            <span className="rounded-full bg-gold-400/20 px-1.5 text-[11px] text-gold-200">
                              в игре{(inGame.get(r.id) ?? 0) > 1 ? ` ×${inGame.get(r.id)}` : ''}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                          {expanded ? t.roles[r.id].long : t.roles[r.id].short}
                        </span>
                        {expanded ? (
                          <span className="mt-2 block text-xs text-faint">
                            {t.teams[team].name} · {t.teams[team].plural}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
