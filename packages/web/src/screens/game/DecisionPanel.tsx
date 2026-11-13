/**
 * Отложенное решение (Охотник, Подрывник, Судья) — только у того, от кого его ждут.
 * Остальные видят нейтральное ожидание: ни чьё решение, ни какого вида.
 */
import type { PlayerId } from '@mafia/engine';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { PlayerPicker } from '../../components/players';
import { IconHourglass } from '../../components/icons';
import { Button, Panel } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { useNames } from './useNames';

export function DecisionPanel() {
  const { game } = useRoomState();
  const decision = game!.view.decision;
  if (!decision) return <Waiting />;
  if (decision.kind === 'judgeVeto') return <JudgeDecision condemned={decision.condemned} />;
  return <TargetDecision kind={decision.kind} options={decision.options} />;
}

export function Waiting() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" data-testid="decision-waiting">
      <motion.div
        animate={{ rotate: [0, 180, 180, 360] }}
        transition={{ duration: 3, repeat: Infinity, times: [0, 0.4, 0.5, 0.9] }}
        className="text-phase-accent"
      >
        <IconHourglass size={44} />
      </motion.div>
      <h2 className="font-display text-2xl">{t.game.decision.waiting}</h2>
      <p className="max-w-xs text-sm text-muted">{t.game.decision.waitingHint}</p>
    </div>
  );
}

function TargetDecision({ kind, options }: { kind: 'hunterShot' | 'bomberBlast'; options: PlayerId[] }) {
  const store = useStore();
  const { game } = useRoomState();
  const view = game!.view;
  const [selected, setSelected] = useState<PlayerId[]>([]);
  const [busy, setBusy] = useState(false);
  const hunter = kind === 'hunterShot';

  const send = async (target: PlayerId | null) => {
    setBusy(true);
    if (hunter) await store.decision({ kind: 'hunterShot', target });
    else if (target) await store.decision({ kind: 'bomberBlast', target });
    setBusy(false);
  };

  return (
    <Panel className="border-wine-400/40" >
      <div data-testid="decision">
        <h2 className="font-display text-2xl">{hunter ? t.game.decision.hunterTitle : t.game.decision.bomberTitle}</h2>
        <p className="mt-1 mb-4 text-[15px] text-paper/85">{hunter ? t.game.decision.hunterText : t.game.decision.bomberText}</p>
        <PlayerPicker players={view.players} candidates={options} selected={selected} max={1} onChange={setSelected} />
        <div className="mt-4 flex gap-3">
          {hunter ? (
            <Button tone="quiet" block disabled={busy} onClick={() => void send(null)}>
              {t.game.decision.hunterSkip}
            </Button>
          ) : null}
          <Button tone="wine" block disabled={busy || selected.length !== 1} onClick={() => void send(selected[0] ?? null)}>
            {hunter ? t.game.decision.shoot : t.game.decision.blast}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function JudgeDecision({ condemned }: { condemned: PlayerId | null }) {
  const store = useStore();
  const name = useNames();
  const [busy, setBusy] = useState(false);
  const send = async (veto: boolean) => {
    setBusy(true);
    await store.decision({ kind: 'judgeVeto', veto });
    setBusy(false);
  };
  return (
    <Panel className="border-gold-400/40">
      <div data-testid="decision">
        <h2 className="font-display text-2xl">{t.game.decision.judgeTitle}</h2>
        <p className="mt-1 mb-5 text-[15px] text-paper/85">{t.game.decision.judgeText(condemned ? name(condemned) : '?')}</p>
        <div className="flex gap-3">
          <Button tone="quiet" block disabled={busy} onClick={() => void send(false)}>
            {t.game.decision.noVeto}
          </Button>
          <Button block disabled={busy} onClick={() => void send(true)}>
            {t.game.decision.veto}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
