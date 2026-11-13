/**
 * Ночь. Общая панель у всех ролей одинакова — и по виду, и по тексту: «Ваш ночной ход»,
 * «Выберите игрока», сетка игроков (никто не затемнён), «Пропустить» и «Сделать ход».
 * Смысл выбора и всё ролевое (что делает способность, сколько осталось, зелье Ведьмы,
 * собственная способность чёрных, голоса команды) — только в «Блокноте». После хода
 * «Блокнот» открывается у всех одинаково. Ночь кончается, когда сходят все.
 */
import type { PlayerId } from '@mafia/engine';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { PlayerPicker } from '../../components/players';
import { IconCheck, IconMoon } from '../../components/icons';
import { Button, Panel, Progress, SectionTitle } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { mainDone, mainMove } from './nightPlan';

export function NightPanel() {
  const { game } = useRoomState();
  const view = game!.view;
  const you = view.you;
  const options = view.night?.options ?? null;
  const progress = game!.progress;

  if (!you || !you.alive || !options) return <Sleeping />;
  return (
    <div className="space-y-4">
      <NightTitle />
      <MainStep />
      {progress ? <Progress done={progress.done} total={progress.total} label={t.game.night.progress(progress.done, progress.total)} /> : null}
    </div>
  );
}

function NightTitle() {
  const { game } = useRoomState();
  return (
    <div className="pt-2 pb-1 text-center">
      <motion.div
        className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-phase-soft text-phase-accent"
        animate={{ boxShadow: ['0 0 0 0 rgba(169,189,224,0.0)', '0 0 40px 6px rgba(169,189,224,0.25)', '0 0 0 0 rgba(169,189,224,0.0)'] }}
        transition={{ duration: 4, repeat: Infinity }}
      >
        <IconMoon size={28} />
      </motion.div>
      <h2 className="font-display text-3xl">{t.game.night.title(game!.view.round)}</h2>
      <p className="font-display text-muted italic">{t.game.night.subtitle}</p>
    </div>
  );
}

function Sleeping() {
  const { game } = useRoomState();
  const progress = game!.progress;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <NightTitle />
      <p className="text-muted">{t.game.night.sleeping}…</p>
      {progress ? (
        <div className="w-full">
          <Progress done={progress.done} total={progress.total} label={t.game.night.progress(progress.done, progress.total)} />
        </div>
      ) : null}
    </div>
  );
}

/** Единственный шаг общей панели. */
function MainStep() {
  const store = useStore();
  const { game, nightChoice } = useRoomState();
  const view = game!.view;
  const you = view.you!;
  const night = view.night!;
  const alive = view.players.filter((p) => p.alive).map((p) => p.id);
  const move = mainMove(night.options!, nightChoice, alive, you.id);
  const done = mainDone(move, night.submitted);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<PlayerId[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async (skip: boolean) => {
    setBusy(true);
    const reply =
      move.kind === 'vote'
        ? await store.night({ kind: 'mafiaVote', target: skip ? null : (selected[0] ?? null) })
        : move.kind === 'ability' && !skip
          ? await store.night({ kind: 'ability', ability: move.option.id, targets: selected })
          : await store.night({ kind: 'pass' });
    setBusy(false);
    if (reply.ok) {
      setEditing(false);
      setSelected([]);
      // у всех одинаково: после хода открывается «Блокнот»
      store.requestNotebook();
    }
  };

  if (done && !editing) {
    return (
      <Panel>
        <SectionTitle>{t.game.night.yourMove}</SectionTitle>
        <div className="flex items-center gap-3" data-testid="move-done">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-phase-soft text-phase-accent">
            <IconCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t.game.night.moveDone}</p>
            <p className="truncate text-sm text-muted">{t.game.night.waiting}</p>
          </div>
          <Button tone="quiet" size="sm" onClick={() => setEditing(true)}>
            {t.game.night.change}
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <div data-testid="night-move">
        <SectionTitle>{t.game.night.yourMove}</SectionTitle>
        <p className="mb-3 text-[15px] text-paper/90">{t.game.night.prompt}</p>
        <PlayerPicker
          players={view.players}
          candidates={move.candidates}
          selected={selected}
          max={move.need}
          onChange={setSelected}
          me={you.id}
          uniform
        />
        <div className="mt-4 flex gap-3">
          <Button tone="quiet" block disabled={busy} onClick={() => void send(true)}>
            {t.game.night.skip}
          </Button>
          <Button block disabled={busy || selected.length !== move.need} onClick={() => void send(false)}>
            {t.game.night.makeMove}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
