/**
 * Ночь. У всех живых — одинаковый по виду ход: сетка игроков и две кнопки «Сделать ход» и
 * «Пропустить». У кого способности нет, выбор — заметка для себя, а на сервер уходит «пустой» ход.
 * Ночь заканчивается, когда сходят все, поэтому по скорости ответа роль не вычислить.
 */
import type { AbilityId, AbilityOption, PlayerId } from '@mafia/engine';
import { motion } from 'framer-motion';
import { type ReactNode, useState } from 'react';
import { PlayerPicker } from '../../components/players';
import { IconCheck, IconEye, IconMoon } from '../../components/icons';
import { Button, IconButton, Panel, Progress, SectionTitle, Segmented } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { useNames } from './useNames';

export function NightPanel() {
  const { game } = useRoomState();
  const view = game!.view;
  const you = view.you;
  const options = view.night?.options ?? null;
  const progress = game!.progress;

  if (!you || !you.alive || !options) return <Sleeping />;

  const hasAbilities = options.abilities.length > 0;
  const black = Boolean(options.mafiaVote);

  return (
    <div className="space-y-4">
      <NightTitle />
      {hasAbilities || !black ? <AbilityStep options={options.abilities} /> : null}
      {options.mafiaVote ? <MafiaVoteStep candidates={options.mafiaVote.candidates} /> : null}
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

/** Шаг со способностью (или «пустой» ход для тех, у кого её нет). */
function AbilityStep({ options }: { options: AbilityOption[] }) {
  const store = useStore();
  const { game } = useRoomState();
  const view = game!.view;
  const submitted = view.night!.submitted;
  const name = useNames();
  const done = submitted.ability !== undefined;
  const [editing, setEditing] = useState(false);
  const [abilityId, setAbilityId] = useState<AbilityId | null>(options[0]?.id ?? null);
  const [selected, setSelected] = useState<PlayerId[]>([]);
  const [busy, setBusy] = useState(false);

  const option = options.find((o) => o.id === abilityId) ?? null;
  const plain = options.length === 0;
  const allAlive = view.players.filter((p) => p.alive).map((p) => p.id);
  const candidates = plain ? allAlive.filter((id) => id !== view.you?.id) : (option?.candidates ?? []);
  const need = plain ? 1 : (option?.targets ?? 1);

  const send = async (pass: boolean) => {
    setBusy(true);
    const reply =
      pass || plain || !option
        ? await store.night({ kind: 'pass' })
        : await store.night({ kind: 'ability', ability: option.id, targets: selected });
    setBusy(false);
    if (reply.ok) setEditing(false);
  };

  if (done && !editing) {
    const ability = submitted.ability;
    return (
      <DoneRow
        testId="move-done"
        detail={ability ? `${t.abilities[ability.id].label}: ${ability.targets.map(name).join(', ')}` : t.game.night.skip}
        onChange={() => setEditing(true)}
      />
    );
  }

  return (
    <Panel>
      <SectionTitle
        aside={option && option.usesLeft !== null ? <span className="text-xs text-muted">{t.game.night.usesLeft(option.usesLeft)}</span> : null}
      >
        {t.game.night.yourMove}
      </SectionTitle>
      {options.length > 1 ? (
        <div className="mb-3">
          <Segmented<AbilityId>
            label={t.game.night.yourMove}
            value={abilityId ?? (options[0] as AbilityOption).id}
            onChange={(id) => {
              setAbilityId(id);
              setSelected([]);
            }}
            options={options.map((o) => ({ value: o.id, label: t.abilities[o.id].label }))}
          />
        </div>
      ) : null}
      <p className="mb-3 text-[15px] text-paper/90">
        {plain ? t.game.night.plainPrompt : option ? t.abilities[option.id].prompt : ''}
      </p>
      <PlayerPicker
        players={view.players}
        candidates={candidates}
        selected={selected}
        max={need}
        onChange={setSelected}
        me={view.you?.id ?? null}
      />
      {plain ? <p className="mt-2 text-xs text-faint">{t.game.night.plainNote}</p> : null}
      <div className="mt-4 flex gap-3">
        <Button tone="quiet" block disabled={busy} onClick={() => void send(true)}>
          {t.game.night.skip}
        </Button>
        <Button block disabled={busy || selected.length !== need} onClick={() => void send(false)}>
          {t.game.night.makeMove}
        </Button>
      </div>
    </Panel>
  );
}

/** Голос мафии за жертву, с голосами команды. */
function MafiaVoteStep({ candidates }: { candidates: PlayerId[] }) {
  const store = useStore();
  const { game } = useRoomState();
  const view = game!.view;
  const name = useNames();
  const submitted = view.night!.submitted;
  const teamVotes = view.night!.teamVotes ?? {};
  const done = submitted.mafiaVote !== undefined;
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<PlayerId[]>([]);
  const [busy, setBusy] = useState(false);

  const marks: Record<PlayerId, string> = {};
  for (const [voter, target] of Object.entries(teamVotes)) {
    if (!target) continue;
    marks[target] = marks[target] ? `${marks[target]}, ${name(voter)}` : `← ${name(voter)}`;
  }

  const send = async (target: PlayerId | null) => {
    setBusy(true);
    const reply = await store.night({ kind: 'mafiaVote', target });
    setBusy(false);
    if (reply.ok) setEditing(false);
  };

  if (done && !editing) {
    return (
      <DoneRow
        testId="mafia-vote-done"
        detail={`${t.game.night.mafiaVote}: ${submitted.mafiaVote ? name(submitted.mafiaVote) : t.game.night.abstain.toLowerCase()}`}
        onChange={() => setEditing(true)}
      >
        <TeamVotes teamVotes={teamVotes} />
      </DoneRow>
    );
  }

  return (
    <Panel>
      <SectionTitle>{t.game.night.yourMove}</SectionTitle>
      <p className="mb-3 text-[15px] text-paper/90">{t.game.night.mafiaPrompt}</p>
      <PlayerPicker
        players={view.players}
        candidates={candidates}
        selected={selected}
        max={1}
        onChange={setSelected}
        marks={marks}
        me={view.you?.id ?? null}
      />
      <div className="mt-4 flex gap-3">
        <Button tone="quiet" block disabled={busy} onClick={() => void send(null)}>
          {t.game.night.skip}
        </Button>
        <Button block disabled={busy || selected.length !== 1} onClick={() => void send(selected[0] ?? null)}>
          {t.game.night.makeMove}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * «Ход сделан». Что именно выбрано, видно только по нажатию на глаз: экран с ходом
 * не должен выдавать роль соседу.
 */
function DoneRow({
  detail,
  onChange,
  testId,
  children,
}: {
  detail: string;
  onChange: () => void;
  testId: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Panel>
      <SectionTitle>{t.game.night.yourMove}</SectionTitle>
      <div className="flex items-center gap-3" data-testid={testId}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-phase-soft text-phase-accent">
          <IconCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t.game.night.moveDone}</p>
          <p className="truncate text-sm text-muted">{shown ? detail : t.game.night.waiting}</p>
        </div>
        <IconButton label={shown ? 'Скрыть ход' : 'Показать ход'} onClick={() => setShown(!shown)}>
          <IconEye size={18} />
        </IconButton>
        <Button tone="quiet" size="sm" onClick={onChange}>
          {t.game.night.change}
        </Button>
      </div>
      {shown ? children : null}
    </Panel>
  );
}

function TeamVotes({ teamVotes }: { teamVotes: Record<PlayerId, PlayerId | null> }) {
  const name = useNames();
  const entries = Object.entries(teamVotes);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-3 space-y-0.5 border-t border-white/8 pt-2 text-sm text-muted">
      {entries.map(([voter, target]) => (
        <li key={voter}>
          {name(voter)} → {target ? name(target) : t.game.night.abstain.toLowerCase()}
        </li>
      ))}
    </ul>
  );
}
