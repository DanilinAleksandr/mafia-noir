/**
 * Журнал партии: события в видимости игрока, по кругам и фазам.
 */
import type { ViewEvent } from '@mafia/engine';
import { t } from '../i18n';
import { type NameOf, type Tone, describeEvent } from '../lib/describe';
import { IconMoon, IconSun } from './icons';
import { cx } from './ui';

export const TONE_CLASS: Record<Tone, string> = {
  death: 'text-[#f08a8f]',
  save: 'text-[#8fd6b4]',
  info: 'text-paper/90',
  private: 'text-gold-200',
  vote: 'text-[#d9c3a0]',
  win: 'text-gold-300 font-semibold',
  plain: 'text-muted',
};

export function Journal({ events, name }: { events: readonly ViewEvent[]; name: NameOf }) {
  const groups: { key: string; title: string; phase: string; lines: { id: number; text: string; tone: Tone }[] }[] = [];
  for (const event of events) {
    const line = describeEvent(event, name);
    if (!line) continue;
    const key = `${event.round}-${event.phase}`;
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const title =
        event.phase === 'night' ? t.log.night(event.round) : event.phase === 'day' ? t.log.day(event.round) : t.log.setup;
      group = { key, title, phase: event.phase, lines: [] };
      groups.push(group);
    }
    group.lines.push({ id: event.id, ...line });
  }
  if (groups.length === 0) return <p className="py-6 text-center text-muted">{t.log.empty}</p>;
  return (
    <div className="space-y-4" data-testid="journal">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold tracking-[0.16em] text-muted uppercase">
            {group.phase === 'night' ? <IconMoon size={13} /> : group.phase === 'day' ? <IconSun size={13} /> : null}
            {group.title}
          </h3>
          <ul className="space-y-1 border-l border-white/10 pl-3">
            {group.lines.map((line) => (
              <li key={line.id} className={cx('text-[14px] leading-snug', TONE_CLASS[line.tone])}>
                {line.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
