/**
 * Утро и вечер — под экраном итогов: ожидание остальных после «готов», повтор итогов,
 * хост может не ждать.
 */
import { IconMoon, IconSun } from '../../components/icons';
import { Button, Progress } from '../../components/ui';
import { t } from '../../i18n';
import { useRoomState, useStore } from '../../store/context';

export function SyncPanel({ isHost }: { isHost: boolean }) {
  const store = useStore();
  const state = useRoomState();
  const game = state.game!;
  const morning = game.stage === 'morning';
  const progress = game.progress;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center" data-testid="sync-panel">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-phase-soft text-phase-accent">
        {morning ? <IconSun size={32} /> : <IconMoon size={32} />}
      </span>
      <div>
        <h2 className="font-display text-3xl">{morning ? t.game.morning.title : t.game.evening.title}</h2>
        <p className="font-display text-muted italic">{morning ? t.game.morning.subtitle : t.game.evening.subtitle}</p>
      </div>
      {progress ? (
        <div className="w-full">
          <Progress done={progress.done} total={progress.total} label={t.game.readyWaiting(progress.done, progress.total)} />
        </div>
      ) : null}
      <div className="w-full space-y-2">
        <Button
          tone="ghost"
          block
          onClick={() => store.presenter.replay({ game, events: state.events, scenes: state.scenes })}
        >
          {morning ? 'Итоги ночи' : 'Итоги дня'}
        </Button>
        {isHost ? (
          <Button tone="quiet" block onClick={() => void store.advance()}>
            {t.game.dontWait}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
