/**
 * Показывает текущее представление из очереди Presenter поверх игрового экрана.
 * Сцену выбирает реестр scenes/registry.ts (сцены грузятся лениво). Здесь же — общее для всех
 * сцен: пропуск тапом, кнопка хоста «Пропустить у всех» и мгновенный переход к концу сцены,
 * когда игра у всех уже пошла дальше.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Suspense, useEffect, useRef } from 'react';
import { SceneStage } from '../scenes/SceneStage';
import { SCENES } from '../scenes/registry';
import { useNames } from '../screens/game/useNames';
import { quality, usePrefs } from '../settings/prefs';
import { useRoomState, useStore } from '../store/context';
import { sceneClock } from '../scenes/clock';

export function PresenterHost() {
  const store = useStore();
  const { presentation, game, room, memberId } = useRoomState();
  const name = useNames();
  const prefs = usePrefs();
  const live =
    game !== null &&
    presentation !== null &&
    'step' in presentation &&
    presentation.step !== null &&
    presentation.step === game.step &&
    (game.stage === 'morning' || game.stage === 'evening');

  // игра ушла дальше (хост пропустил или вышло время) — анимацию досматривать незачем
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !live) sceneClock.skip();
    wasLive.current = live;
  }, [live, presentation?.id]);

  if (!game) return null;
  const Scene = presentation ? SCENES[presentation.kind] : null;
  const isHost = room?.hostId === memberId;
  return (
    <AnimatePresence mode="wait">
      {presentation && Scene ? (
        <motion.div
          key={presentation.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="relative z-30"
        >
          <SceneStage hostSkip={isHost && live ? () => void store.advance() : null}>
            <Suspense fallback={<div className="fixed inset-0 z-30 bg-ink" />}>
              <Scene
                presentation={presentation}
                view={game.view}
                name={name}
                display={game.display}
                prefs={prefs}
                quality={quality(prefs)}
                live={live}
                onComplete={() => store.presenter.complete(presentation.id)}
              />
            </Suspense>
          </SceneStage>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
