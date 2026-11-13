/**
 * Обёртка любой сцены: тап по сцене — пропуск (к концу анимации), у хоста во время общих
 * сцен — кнопка «Пропустить у всех» (продвигает игру; у остальных сцены досматриваются мгновенно).
 * Кнопки внутри сцен останавливают всплытие, поэтому их нажатие сцену не пропускает.
 */
import type { ReactNode } from 'react';
import { sceneClock } from './clock';

export function SceneStage({ children, hostSkip }: { children: ReactNode; hostSkip: (() => void) | null }) {
  return (
    <div onPointerDown={() => sceneClock.skip()}>
      {children}
      {hostSkip ? (
        <button
          type="button"
          data-testid="host-skip"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={hostSkip}
          className="safe-top fixed top-2 right-3 z-[45] rounded-full border border-gold-400/40 bg-black/60 px-3 py-1.5 text-xs font-semibold text-gold-200 backdrop-blur"
        >
          Пропустить у всех
        </button>
      ) : null}
    </div>
  );
}
