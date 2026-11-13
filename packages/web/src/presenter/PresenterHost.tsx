/**
 * Показывает текущее представление из очереди Presenter поверх игрового экрана.
 * Какой компонент рисует какое представление — решает реестр `renderers`.
 */
import { AnimatePresence, motion } from 'framer-motion';
import type { ComponentType } from 'react';
import { useNames } from '../screens/game/useNames';
import { useRoomState, useStore } from '../store/context';
import type { Presentation } from './presenter';
import { type RendererProps, renderers } from './renderers';

export function PresenterHost() {
  const store = useStore();
  const { presentation, game } = useRoomState();
  const name = useNames();
  if (!game) return null;
  const Renderer = presentation
    ? (renderers[presentation.kind] as ComponentType<RendererProps<Presentation>>)
    : null;
  const live =
    presentation !== null &&
    'step' in presentation &&
    presentation.step !== null &&
    presentation.step === game.step &&
    (game.stage === 'morning' || game.stage === 'evening');
  return (
    <AnimatePresence mode="wait">
      {presentation && Renderer ? (
        <motion.div
          key={presentation.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="relative z-30"
        >
          <Renderer presentation={presentation} view={game.view} name={name} live={live} onDone={() => store.presenter.complete(presentation.id)} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
