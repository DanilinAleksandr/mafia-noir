/**
 * Экран ведущего-наблюдателя: все роли, чужие ходы и голоса в реальном времени («закулисье»),
 * журнал целиком, чат мафии (только чтение) и кнопки ведения партии.
 */
import type { NightEntry, PlayerId } from '@mafia/engine';
import { useState } from 'react';
import { Countdown } from '../../components/Countdown';
import { Journal } from '../../components/Journal';
import { PlayerRow } from '../../components/players';
import { IconCrown } from '../../components/icons';
import { Button, Panel, Progress, SectionTitle, Segmented, useConfirm } from '../../components/ui';
import { t } from '../../i18n';
import { PresenterHost } from '../../presenter/PresenterHost';
import { useRoomState, useStore } from '../../store/context';
import { FinalPanel } from './FinalPanel';
import { phaseOf } from './GameScreen';
import { MafiaChat } from './MafiaChat';
import { useNames } from './useNames';

type Tab = 'table' | 'log' | 'chat';

export function NarratorScreen() {
  const store = useStore();
  const state = useRoomState();
  const game = state.game!;
  const view = game.view;
  const backstage = view.backstage!;
  const name = useNames();
  const [tab, setTab] = useState<Tab>('table');
  const [confirmNode, confirm] = useConfirm();
  const isHost = state.room?.hostId === state.memberId;
  const advance = t.game.advance[game.stage];

  const moveText = (entry: NightEntry | undefined): string | null => {
    if (!entry) return null;
    const parts: string[] = [];
    if (entry.ability === null) parts.push('пропуск');
    else if (entry.ability) parts.push(`${t.abilities[entry.ability.id].label}: ${entry.ability.targets.map(name).join(', ')}`);
    if (entry.mafiaVote !== undefined) parts.push(`голос мафии: ${entry.mafiaVote ? name(entry.mafiaVote) : 'воздержание'}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  };
  const voteText = (id: PlayerId): string | null => {
    if (!(id in backstage.votes)) return null;
    const target = backstage.votes[id];
    return `голос: ${target ? name(target) : 'воздержание'}`;
  };

  return (
    <div data-phase={phaseOf(game.stage, view.phase)} className="scene-bg min-h-dvh" data-testid="narrator">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-28">
        <header className="safe-top flex items-center gap-2 pb-2">
          <IconCrown className="text-gold-300" />
          <div className="flex-1">
            <div className="font-display text-xl leading-tight">
              {t.game.narratorTitle} · {t.stages[game.stage]}
            </div>
            <div className="text-[11px] tracking-[0.16em] text-muted uppercase">{t.game.round(view.round)}</div>
          </div>
          <Countdown deadline={game.deadline} clockOffset={state.clockOffset} />
        </header>

        <Segmented<Tab>
          label="Разделы"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'table', label: t.game.players },
            { value: 'log', label: t.game.journal },
            { value: 'chat', label: t.game.night.chat },
          ]}
        />

        <div className="mt-4 space-y-4">
          {game.stage === 'ended' && tab === 'table' ? <FinalPanel isHost={isHost} /> : null}
          {tab === 'table' && game.stage !== 'ended' ? (
            <>
              {game.progress ? <Progress done={game.progress.done} total={game.progress.total} label={`${t.stages[game.stage]}: ${game.progress.done} из ${game.progress.total}`} /> : null}
              {backstage.decision ? (
                <div className="rounded-2xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm">
                  Ждём решения: <b>{name(backstage.decision.playerId)}</b> ({backstage.decision.kind === 'hunterShot' ? 'выстрел Охотника' : backstage.decision.kind === 'bomberBlast' ? 'взрыв Подрывника' : 'отмена Судьи'})
                </div>
              ) : null}
              <Panel>
                <SectionTitle>{t.game.players}</SectionTitle>
                <ul className="divide-y divide-white/6">
                  {view.players.map((p) => {
                    const note = game.stage === 'night' ? moveText(backstage.nightMoves[p.id]) : game.stage === 'day' ? voteText(p.id) : null;
                    return <PlayerRow key={p.id} player={p} me={false} revealAlive note={note ? <span className="text-gold-200">{note}</span> : null} />;
                  })}
                </ul>
                {backstage.lovers.length > 0 ? (
                  <p className="mt-2 text-xs text-team-red">
                    Влюблённые: {backstage.lovers.map(([a, b]) => `${name(a)} и ${name(b)}`).join('; ')}
                  </p>
                ) : null}
              </Panel>
            </>
          ) : null}
          {tab === 'log' ? (
            <Panel>
              <Journal events={state.events} name={name} />
            </Panel>
          ) : null}
          {tab === 'chat' ? (
            <Panel>
              <MafiaChat readOnly />
            </Panel>
          ) : null}
        </div>
      </div>

      {isHost && game.stage !== 'ended' ? (
        <footer className="safe-bottom fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pt-6">
          <div className="mx-auto flex max-w-md gap-2">
            <Button tone="danger" onClick={() => confirm(t.game.confirmToLobby, () => void store.toLobby())}>
              Лобби
            </Button>
            {advance ? (
              <Button block size="lg" onClick={() => void store.advance()} data-testid="narrator-advance">
                {advance}
              </Button>
            ) : null}
          </div>
        </footer>
      ) : null}
      <PresenterHost />
      {confirmNode}
    </div>
  );
}
