/**
 * Игровой экран: шапка со стадией и таймером, панель текущей стадии, представления (PresenterHost)
 * и листы: моя роль, журнал, справочник, чат мафии, меню хоста.
 */
import type { GameStage } from '@mafia/protocol';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Countdown } from '../../components/Countdown';
import { HoldToReveal } from '../../components/HoldToReveal';
import { Journal } from '../../components/Journal';
import { PrefsSheet } from '../../components/PrefsSheet';
import { RoleReference } from '../../components/RoleReference';
import { IconBook, IconCard, IconChat, IconCog, IconCrown, IconMoon, IconScroll, IconSun } from '../../components/icons';
import { Button, IconButton, Sheet, Spinner, useConfirm } from '../../components/ui';
import { roleName, t } from '../../i18n';
import { PresenterHost } from '../../presenter/PresenterHost';
import { useRoomState, useStore } from '../../store/context';
import { DecisionPanel } from './DecisionPanel';
import { DiscussionPanel, VotePanel } from './DayPanels';
import { FinalPanel } from './FinalPanel';
import { Notebook } from './MafiaChat';
import { NarratorScreen } from './NarratorScreen';
import { NightPanel } from './NightPanel';
import { SyncPanel } from './SyncPanel';
import { useNames } from './useNames';

export function phaseOf(stage: GameStage, viewPhase: string): 'night' | 'day' | 'ended' {
  if (stage === 'ended') return 'ended';
  if (stage === 'night') return 'night';
  if (stage === 'decision') return viewPhase === 'night' ? 'night' : 'day';
  return 'day';
}

export function GameScreen() {
  const state = useRoomState();
  const game = state.game;
  if (!game) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (!game.view.you && game.view.backstage) return <NarratorScreen />;
  return <PlayerGame />;
}

function PlayerGame() {
  const store = useStore();
  const state = useRoomState();
  const game = state.game!;
  const view = game.view;
  const you = view.you;
  const name = useNames();
  const isHost = state.room?.hostId === state.memberId;
  const phase = phaseOf(game.stage, view.phase);
  const [sheet, setSheet] = useState<'role' | 'journal' | 'roles' | 'chat' | 'host' | 'prefs' | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const setChatOpen = useCallback((open: boolean) => store.setChatOpen(open), [store]);
  // после ночного хода «Блокнот» открывается у всех одинаково
  const notebookRequest = state.notebookRequest;
  // (только пока идёт ночь и нет сцены: последний ход разрешает ночь, и утро может прийти раньше ответа)
  const canOpenNotebook = game.stage === 'night' && state.presentation === null;
  useEffect(() => {
    if (notebookRequest > 0 && canOpenNotebook) setSheet('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookRequest]);
  // началась сцена — открытые листы закрываются, чтобы не перекрывать её
  const presentationId = state.presentation?.id ?? null;
  useEffect(() => {
    if (presentationId !== null) setSheet(null);
  }, [presentationId]);

  const teammates = view.players.filter((p) => p.team === 'black' && p.id !== you?.id && you?.team === 'black');

  return (
    <div data-phase={phase} className="scene-bg relative min-h-dvh" data-stage={game.stage}>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
        <header className="safe-top sticky top-0 z-20 -mx-4 bg-gradient-to-b from-black/70 to-transparent px-3 pb-2">
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-phase-accent">{phase === 'night' ? <IconMoon /> : <IconSun />}</span>
              <div className="min-w-0">
                <div className="truncate font-display text-xl leading-tight" data-testid="stage-title">
                  {game.stage === 'decision' && view.decision ? 'Ваше решение' : t.stages[game.stage]}
                </div>
                <div className="text-[11px] tracking-[0.16em] text-muted uppercase">{t.game.round(view.round)}</div>
              </div>
            </div>
            <Countdown deadline={game.deadline} clockOffset={state.clockOffset} />
            {/* блокнот — у всех: у чёрных за ним чат команды, у остальных заметки */}
            {you && game.stage !== 'ended' ? (
              <IconButton label={t.game.notebook.title} onClick={() => setSheet('chat')}>
                <IconChat />
              </IconButton>
            ) : null}
            <IconButton label={t.game.journal} onClick={() => setSheet('journal')}>
              <IconScroll />
            </IconButton>
            <IconButton label={t.game.reference} onClick={() => setSheet('roles')}>
              <IconBook />
            </IconButton>
            <IconButton label="Эффекты и звук" onClick={() => setSheet('prefs')}>
              <IconCog />
            </IconButton>
            {isHost ? (
              <IconButton label={t.game.hostMenu} onClick={() => setSheet('host')}>
                <IconCrown className="text-gold-300" />
              </IconButton>
            ) : null}
          </div>
        </header>

        {you && !you.alive && game.stage !== 'ended' ? (
          <div className="mt-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-center" data-testid="spectator">
            <p className="font-display text-lg">{t.game.spectator}</p>
            <p className="text-xs text-muted">{t.game.spectatorHint}</p>
          </div>
        ) : null}

        <main className="flex flex-1 flex-col pt-3 pb-28">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${game.stage}-${game.step}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="flex flex-1 flex-col"
            >
              <StagePanel isHost={isHost} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {you && game.stage !== 'ended' ? (
        <button
          type="button"
          onClick={() => setSheet('role')}
          className="safe-bottom fixed bottom-0 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-t-2xl border border-b-0 border-gold-400/30 bg-coal/95 px-5 pt-2.5 text-sm text-gold-200 shadow-[0_-10px_30px_-10px_black]"
        >
          <IconCard size={18} /> {t.game.myRole}
        </button>
      ) : null}

      <Sheet open={sheet === 'role'} onClose={() => setSheet(null)} title={t.game.myRole}>
        {you ? (
          <HoldToReveal role={you.role} team={you.team}>
            <p className="font-display text-2xl">{roleName(you.role)}</p>
            <p className="mt-1 text-sm text-muted">{t.roles[you.role].long}</p>
            {teammates.length > 0 ? (
              <p className="mt-2 text-sm text-gold-200">
                {t.game.teammates}: {teammates.map((p) => `${p.name}${p.role ? ` (${roleName(p.role)})` : ''}`).join(', ')}
              </p>
            ) : null}
            {you.lovers.length > 0 ? (
              <p className="mt-2 text-sm text-team-red">Вы связаны с: {you.lovers.map(name).join(', ')}</p>
            ) : null}
          </HoldToReveal>
        ) : null}
      </Sheet>
      <Sheet open={sheet === 'journal'} onClose={() => setSheet(null)} title={t.game.journal}>
        <Journal events={state.events} name={name} />
      </Sheet>
      <Sheet open={sheet === 'roles'} onClose={() => setSheet(null)} title={t.game.reference}>
        <RoleReference rules={view.rules} composition={game.composition} highlight={you?.role ?? null} />
      </Sheet>
      <Sheet open={sheet === 'chat'} onClose={() => setSheet(null)} title={t.game.notebook.title}>
        <Notebook onOpenChange={setChatOpen} />
      </Sheet>
      <PrefsSheet open={sheet === 'prefs'} onClose={() => setSheet(null)} />
      <Sheet open={sheet === 'host'} onClose={() => setSheet(null)} title={t.game.hostMenu}>
        <HostMenu
          onAdvance={() => {
            setSheet(null);
            void store.advance();
          }}
          onLobby={() =>
            confirm(t.game.confirmToLobby, () => {
              setSheet(null);
              void store.toLobby();
            })
          }
        />
      </Sheet>
      <PresenterHost />
      {confirmNode}
    </div>
  );
}

function StagePanel({ isHost }: { isHost: boolean }) {
  const { game } = useRoomState();
  if (!game) return null;
  switch (game.stage) {
    case 'night':
      return <NightPanel />;
    case 'decision':
      return <DecisionPanel />;
    case 'morning':
    case 'evening':
      return <SyncPanel isHost={isHost} />;
    case 'discussion':
      return <DiscussionPanel isHost={isHost} />;
    case 'day':
      return <VotePanel isHost={isHost} />;
    case 'ended':
      return <FinalPanel isHost={isHost} />;
  }
}

export function HostMenu({ onAdvance, onLobby }: { onAdvance: () => void; onLobby: () => void }) {
  const { game } = useRoomState();
  if (!game) return null;
  const label = t.game.advance[game.stage];
  return (
    <div className="space-y-3 pb-2">
      {label ? (
        <Button block onClick={onAdvance}>
          {label}
        </Button>
      ) : null}
      <Button tone="danger" block onClick={onLobby}>
        {t.game.toLobby}
      </Button>
    </div>
  );
}
