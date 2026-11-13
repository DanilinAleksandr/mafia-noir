/**
 * «Блокнот» — одна и та же кнопка и один и тот же вид у всех игроков, чтобы по экрану нельзя
 * было понять, кто мафия. У живых чёрных за ним чат команды (писать — только ночью) и голоса
 * команды за жертву; у остальных — личные заметки, которые хранятся только на этом устройстве.
 * Ведущий читает чат мафии без права писать (MafiaChat с readOnly).
 */
import type { AbilityId, AbilityOption, PlayerId } from '@mafia/engine';
import { LIMITS } from '@mafia/protocol';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { PlayerPicker } from '../../components/players';
import { Button, Segmented, cx } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { mainMove, sideAbilities } from './nightPlan';
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

/** Своя способность чёрного (вдобавок к голосу в общей панели) — выполняется здесь. */
function SideAbility({ option }: { option: AbilityOption }) {
  const store = useStore();
  const { game } = useRoomState();
  const view = game!.view;
  const submitted = view.night!.submitted;
  const name = useNames();
  const [selected, setSelected] = useState<PlayerId[]>([]);
  const done = submitted.ability !== undefined;
  const send = async (pass: boolean) => {
    const reply = pass
      ? await store.night({ kind: 'pass' })
      : await store.night({ kind: 'ability', ability: option.id, targets: selected });
    if (reply.ok) setSelected([]);
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3" data-testid="side-ability" data-done={done ? '1' : '0'}>
      <p className="mb-2 text-sm">
        {t.abilities[option.id].prompt}
        {done ? (
          <span className="block text-xs text-ok">
            {submitted.ability ? `${t.abilities[submitted.ability.id].label}: ${submitted.ability.targets.map(name).join(', ')}` : t.game.night.skip}
          </span>
        ) : null}
      </p>
      <PlayerPicker players={view.players} candidates={option.candidates} selected={selected} max={option.targets} onChange={setSelected} me={view.you?.id ?? null} />
      <div className="mt-3 flex gap-2">
        <Button tone="quiet" size="sm" block onClick={() => void send(true)}>
          {t.game.night.skip}
        </Button>
        <Button tone="ghost" size="sm" block data-testid="side-apply" disabled={selected.length !== option.targets} onClick={() => void send(false)}>
          {t.abilities[option.id].label}
        </Button>
      </div>
    </div>
  );
}

/** Ночная памятка: что значит выбор в общей панели и всё, что зависит от роли. */
function NightBrief() {
  const store = useStore();
  const { game, nightChoice } = useRoomState();
  const view = game?.view;
  const name = useNames();
  const options = view?.night?.options;
  if (!view?.you?.alive || game?.stage !== 'night' || !options || !view.night) return null;
  const alive = view.players.filter((p) => p.alive).map((p) => p.id);
  const move = mainMove(options, nightChoice, alive, view.you.id);
  const submitted = view.night.submitted;
  const mine =
    move.kind === 'vote'
      ? submitted.mafiaVote !== undefined
        ? `${t.game.night.mafiaVote}: ${submitted.mafiaVote ? name(submitted.mafiaVote) : t.game.night.abstain.toLowerCase()}`
        : null
      : submitted.ability !== undefined
        ? submitted.ability
          ? `${t.abilities[submitted.ability.id].label}: ${submitted.ability.targets.map(name).join(', ')}`
          : t.game.night.skip
        : null;
  return (
    <div className="space-y-2 rounded-2xl border border-gold-400/25 bg-gold-400/5 p-3" data-testid="night-brief">
      <p className="text-xs font-bold tracking-[0.16em] text-gold-300 uppercase">{t.game.notebook.tonight}</p>
      {move.kind === 'vote' ? <p className="text-sm">{t.game.notebook.voteMeaning}</p> : null}
      {move.kind === 'plain' ? <p className="text-sm">{t.game.notebook.plainMeaning}</p> : null}
      {move.kind === 'ability' ? (
        <>
          {options.abilities.length > 1 ? (
            <Segmented<AbilityId>
              label={t.game.night.yourMove}
              value={move.option.id}
              onChange={(id) => store.setNightChoice(id)}
              options={options.abilities.map((o) => ({ value: o.id, label: t.abilities[o.id].label }))}
            />
          ) : null}
          <p className="text-sm">
            {t.game.notebook.abilityMeaning(t.abilities[move.option.id].prompt)}
            {move.option.usesLeft !== null ? <span className="text-muted"> {t.game.night.usesLeft(move.option.usesLeft)}</span> : null}
          </p>
        </>
      ) : null}
      {mine ? <p className="text-sm text-ok">{t.game.notebook.yourMove(mine)}</p> : null}
      {sideAbilities(options).map((option) => (
        <SideAbility key={option.id} option={option} />
      ))}
      {move.kind === 'vote' && view.night.teamVotes ? <TeamVotes votes={view.night.teamVotes} /> : null}
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
        header={<NightBrief />}
        bubbles={chat.map((m) => ({ id: m.id, author: m.from === memberId ? null : m.name, text: m.text, mine: m.from === memberId }))}
        empty={t.game.notebook.empty}
        canWrite={canWrite}
        onSend={async (text) => (await store.chat(text)).ok}
      />
    );
  }
  return (
    <Pad
      header={<NightBrief />}
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
