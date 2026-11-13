/**
 * День: обсуждение (голоса ещё не принимаются) и голосование.
 */
import type { PlayerId, ViewPlayer } from '@mafia/engine';
import { useState } from 'react';
import { PlayerPicker, PlayerRow } from '../../components/players';
import { IconCheck, IconMute } from '../../components/icons';
import { Button, Panel, Progress, SectionTitle } from '../../components/ui';
import { t } from '../../i18n';
import { segment } from '../../presenter/digest';
import { useRoomState, useStore } from '../../store/context';
import { useNames } from './useNames';

function DayTitle({ subtitle }: { subtitle: string }) {
  const { game } = useRoomState();
  return (
    <div className="pt-1 pb-2 text-center">
      <h2 className="font-display text-3xl">{t.game.day.title(game!.view.round)}</h2>
      <p className="font-display text-muted italic">{subtitle}</p>
    </div>
  );
}

function Table({ players, me, marks }: { players: ViewPlayer[]; me: PlayerId | null; marks?: Partial<Record<PlayerId, boolean>> }) {
  const alive = players.filter((p) => p.alive);
  const dead = players.filter((p) => !p.alive);
  return (
    <Panel>
      <SectionTitle aside={<span className="text-xs text-muted">{alive.length}</span>}>{t.game.alive}</SectionTitle>
      <ul className="divide-y divide-white/6">
        {alive.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            me={p.id === me}
            aside={marks?.[p.id] ? <IconCheck size={18} className="text-ok" aria-label={t.game.day.voted} /> : null}
          />
        ))}
      </ul>
      {dead.length > 0 ? (
        <>
          <div className="mt-3">
            <SectionTitle>{t.game.dead}</SectionTitle>
          </div>
          <ul className="divide-y divide-white/6">
            {dead.map((p) => (
              <PlayerRow key={p.id} player={p} me={p.id === me} />
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

export function DiscussionPanel({ isHost }: { isHost: boolean }) {
  const store = useStore();
  const { game } = useRoomState();
  const view = game!.view;
  return (
    <div className="space-y-4">
      <DayTitle subtitle={t.game.day.discussionHint} />
      {view.you?.alive && view.you.silenced ? (
        <div className="flex items-center gap-3 rounded-2xl border border-wine-400/40 bg-wine-700/30 px-4 py-3 text-sm" data-testid="silenced-me">
          <IconMute size={20} className="shrink-0" /> {t.game.day.silencedYou}
        </div>
      ) : null}
      <Table players={view.players} me={view.you?.id ?? null} />
      {isHost ? (
        <div className="safe-bottom fixed inset-x-0 bottom-12 z-10 mx-auto max-w-md px-4">
          <Button block size="lg" onClick={() => void store.advance()} data-testid="start-vote">
            {t.game.day.startVote}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted">{game!.deadline ? t.game.day.timerStarts : t.game.day.hostStarts}</p>
      )}
    </div>
  );
}

export function VotePanel({ isHost }: { isHost: boolean }) {
  const store = useStore();
  const state = useRoomState();
  const game = state.game!;
  const view = game.view;
  const day = view.day;
  const name = useNames();
  const [selected, setSelected] = useState<PlayerId[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!day) return null;

  const me = view.you?.id ?? null;
  const revote = day.stage === 'revote';
  const candidates = (day.candidates ?? view.players.filter((p) => p.alive).map((p) => p.id)).filter((id) => id !== me);
  const voted = Object.fromEntries(day.voted.map((id) => [id, true]));
  const hasVoted = day.myVote !== undefined;

  // открытое голосование: подписи «← кто голосует»
  const marks: Record<PlayerId, string> = {};
  for (const [voter, target] of Object.entries(day.ballots ?? {})) {
    if (!target) continue;
    marks[target] = marks[target] ? `${marks[target]}, ${name(voter)}` : `← ${name(voter)}`;
  }
  // при переголосовании — итоги первого круга
  const firstRound = revote ? segment(state.events, 'dayStarted').find((e) => e.type === 'voteResult') : undefined;

  const send = async (target: PlayerId | null) => {
    setBusy(true);
    const reply = await store.vote(target);
    setBusy(false);
    if (reply.ok) setEditing(false);
  };

  return (
    <div className="space-y-4">
      <DayTitle subtitle={revote ? t.game.day.revote : t.game.day.vote} />
      {revote ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm" data-testid="revote">
          {t.game.day.revoteHint}
          {firstRound && firstRound.type === 'voteResult' && firstRound.data.tally ? (
            <span className="mt-1 block text-muted">
              {Object.entries(firstRound.data.tally)
                .sort((a, b) => b[1] - a[1])
                .map(([id, n]) => `${name(id)} — ${n}`)
                .join(', ')}
            </span>
          ) : null}
        </div>
      ) : null}

      {day.canVote ? (
        hasVoted && !editing ? (
          <Panel>
            <div className="flex items-center gap-3" data-testid="vote-done">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-phase-soft text-phase-accent">
                <IconCheck size={18} />
              </span>
              <div className="flex-1">
                <p className="font-semibold">{day.myVote ? t.game.day.youVoted(name(day.myVote)) : t.game.day.youAbstained}</p>
                <p className="text-xs text-muted">{t.game.day.canChange}</p>
              </div>
              <Button tone="quiet" size="sm" onClick={() => setEditing(true)}>
                {t.game.night.change}
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel>
            <SectionTitle>{t.game.day.votePrompt}</SectionTitle>
            <PlayerPicker
              players={view.players}
              candidates={candidates}
              selected={selected}
              max={1}
              onChange={setSelected}
              marks={marks}
              me={me}
            />
            <div className="mt-4 flex gap-3">
              <Button tone="quiet" block disabled={busy} onClick={() => void send(null)}>
                {t.game.day.abstain}
              </Button>
              <Button tone="wine" block disabled={busy || selected.length !== 1} onClick={() => void send(selected[0] ?? null)}>
                {t.game.day.castVote}
              </Button>
            </div>
          </Panel>
        )
      ) : (
        <p className="text-center text-sm text-muted">{t.game.day.cannotVote}</p>
      )}

      {game.progress ? (
        <Progress done={game.progress.done} total={game.progress.total} label={t.game.day.progress(game.progress.done, game.progress.total)} />
      ) : null}
      <Table players={view.players} me={me} marks={voted} />
      {isHost ? (
        <Button tone="ghost" block onClick={() => void store.advance()}>
          {t.game.advance.day}
        </Button>
      ) : null}
    </div>
  );
}
