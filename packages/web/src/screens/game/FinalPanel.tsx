/**
 * Финал: победитель, все роли, журнал, «Сыграть ещё раз».
 */
import { useState } from 'react';
import { Journal } from '../../components/Journal';
import { RoleCard } from '../../components/RoleCard';
import { IconCrown } from '../../components/icons';
import { Button, Ornament, Panel, SectionTitle, cx } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';
import { useNames } from './useNames';

export function FinalPanel({ isHost }: { isHost: boolean }) {
  const store = useStore();
  const state = useRoomState();
  const game = state.game!;
  const view = game.view;
  const result = view.result;
  const name = useNames();
  const [logOpen, setLogOpen] = useState(false);
  if (!result) return null;
  const winners = new Set(result.winners);
  const outcome = t.outcomes[result.outcome];

  return (
    <div className="space-y-5" data-testid="final">
      <div className="pt-2 text-center">
        <p className="text-xs font-bold tracking-[0.3em] text-muted uppercase">{t.stages.ended}</p>
        <h2 className="gold-text font-display text-[40px] leading-tight font-bold">{outcome.title}</h2>
        <p className="font-display text-paper/80 italic">{t.winReasons[result.reason]}</p>
      </div>
      <Ornament />
      <Panel>
        <SectionTitle>{t.game.ended.allRoles}</SectionTitle>
        <ul className="grid grid-cols-3 gap-x-2 gap-y-4">
          {view.players.map((p) => (
            <li key={p.id} className={cx('flex flex-col items-center text-center', !p.alive && 'opacity-60')}>
              <div className="relative">
                <RoleCard role={p.role} team={p.team} faceUp width={92} />
                {winners.has(p.id) ? (
                  <span
                    className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-gold-400 text-ink shadow"
                    aria-label={t.game.ended.winners}
                  >
                    <IconCrown size={15} />
                  </span>
                ) : null}
              </div>
              <span className="mt-1.5 w-full truncate text-[13px] font-semibold">{p.name}</span>
              <span className="text-[11px] text-muted">{p.alive ? 'в живых' : p.deathCause ? t.deathCauses[p.deathCause] : 'вне игры'}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <SectionTitle
          aside={
            <Button tone="quiet" size="sm" onClick={() => setLogOpen(!logOpen)}>
              {logOpen ? 'Свернуть' : 'Показать'}
            </Button>
          }
        >
          {t.game.ended.log}
        </SectionTitle>
        {logOpen ? <Journal events={state.events} name={name} /> : null}
      </Panel>
      <div className="pb-4">
        {isHost ? (
          <Button block size="lg" onClick={() => void store.toLobby()} data-testid="play-again">
            {t.game.ended.again}
          </Button>
        ) : (
          <p className="text-center text-sm text-muted">{t.game.ended.waitHost}</p>
        )}
      </div>
    </div>
  );
}
