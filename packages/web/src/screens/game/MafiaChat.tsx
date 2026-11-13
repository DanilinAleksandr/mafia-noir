/**
 * «Блокнот» — одна и та же кнопка и один и тот же вид у всех игроков, чтобы по экрану нельзя
 * было понять, кто мафия. У живых чёрных за ним чат команды (писать — только ночью) и голоса
 * команды за жертву; у остальных — личные заметки, которые хранятся только на этом устройстве.
 * Ведущий читает чат мафии без права писать (MafiaChat с readOnly).
 */
import type { PlayerId } from '@mafia/engine';
import { LIMITS } from '@mafia/protocol';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Button, cx } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { useNames } from './useNames';

interface Bubble {
  id: number;
  author: string | null;
  text: string;
  mine: boolean;
}

/** Общий вид блокнота: лента и поле ввода. */
function Pad({
  bubbles,
  empty,
  header,
  canWrite,
  onSend,
}: {
  bubbles: Bubble[];
  empty: string;
  header?: ReactNode;
  canWrite: boolean;
  onSend?: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [bubbles.length]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean || !onSend) return;
    if (await onSend(clean)) setText('');
  };
  return (
    <div className="flex flex-col gap-3">
      {header}
      <div className="min-h-40 space-y-2" data-testid="notebook-log">
        {bubbles.length === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : null}
        {bubbles.map((b) => (
          <div key={b.id} className={cx('flex flex-col', b.mine ? 'items-end' : 'items-start')}>
            {b.author ? <span className="mb-0.5 text-[11px] text-muted">{b.author}</span> : null}
            <span
              className={cx(
                'max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug whitespace-pre-wrap',
                b.mine ? 'rounded-br-md bg-ash' : 'rounded-bl-md bg-white/8',
              )}
            >
              {b.text}
            </span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {onSend ? (
        <form onSubmit={submit} className="sticky bottom-0 flex gap-2 bg-coal pt-1">
          <input
            value={text}
            maxLength={LIMITS.chatMax}
            disabled={!canWrite}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.game.notebook.placeholder}
            aria-label={t.game.notebook.placeholder}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none focus:border-gold-400/70 disabled:opacity-50"
          />
          <Button type="submit" tone="ghost" disabled={!canWrite || !text.trim()}>
            {t.game.notebook.send}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Голоса чёрной команды за жертву — только внутри блокнота, не на основной панели. */
function TeamVotes({ votes }: { votes: Record<PlayerId, PlayerId | null> }) {
  const name = useNames();
  const entries = Object.entries(votes);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm" data-testid="team-votes">
      <p className="mb-1 text-xs font-bold tracking-[0.16em] text-muted uppercase">{t.game.night.teamVotes}</p>
      <ul className="space-y-0.5 text-paper/85">
        {entries.map(([voter, target]) => (
          <li key={voter}>
            {name(voter)} → {target ? name(target) : t.game.night.abstain.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Блокнот игрока: чат команды у чёрных, заметки у остальных. */
export function Notebook({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const store = useStore();
  const { chat, memberId, game, notes } = useRoomState();
  const you = game?.view.you;
  const team = you?.team === 'black';

  useEffect(() => {
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [onOpenChange]);

  if (team) {
    const night = game?.stage === 'night';
    const canWrite = night && Boolean(you?.alive);
    return (
      <Pad
        header={night && game?.view.night?.teamVotes ? <TeamVotes votes={game.view.night.teamVotes} /> : null}
        bubbles={chat.map((m) => ({ id: m.id, author: m.from === memberId ? null : m.name, text: m.text, mine: m.from === memberId }))}
        empty={t.game.notebook.empty}
        canWrite={canWrite}
        onSend={async (text) => (await store.chat(text)).ok}
      />
    );
  }
  return (
    <Pad
      bubbles={notes.map((n) => ({ id: n.id, author: null, text: n.text, mine: true }))}
      empty={t.game.notebook.empty}
      canWrite
      onSend={async (text) => {
        store.addNote(text);
        return true;
      }}
    />
  );
}

/** Чат мафии для ведущего: только чтение. */
export function MafiaChat({ readOnly = true }: { readOnly?: boolean }) {
  const { chat } = useRoomState();
  return (
    <>
      {readOnly ? <p className="mb-2 text-xs text-muted">{t.game.night.chatReadOnly}</p> : null}
      <Pad
        bubbles={chat.map((m) => ({ id: m.id, author: m.name, text: m.text, mine: false }))}
        empty={t.game.night.chatEmpty}
        canWrite={false}
      />
    </>
  );
}
