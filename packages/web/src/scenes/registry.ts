/**
 * Реестр сцен: какой компонент показывает какое представление. Все сцены грузятся лениво —
 * GSAP, Howler и сами сцены не попадают в начальный бандл.
 *
 * Сцены этапа 4 появляются по подэтапам; пока сцены нет, работает простой экран этапа 3
 * (presenter/renderers.tsx) через переходник с тем же контрактом.
 */
import { type ComponentType, type LazyExoticComponent, createElement, lazy } from 'react';
import type { Presentation, PresentationKind } from '../presenter/presenter';
import type { SceneProps } from './types';

type AnyScene = ComponentType<SceneProps<Presentation>>;

/** Простой экран этапа 3 под контрактом сцены. */
function legacy(kind: PresentationKind): LazyExoticComponent<AnyScene> {
  return lazy(async () => {
    const { renderers } = await import('../presenter/renderers');
    const Renderer = renderers[kind] as ComponentType<{
      presentation: Presentation;
      view: SceneProps['view'];
      name: SceneProps['name'];
      live: boolean;
      onDone: () => void;
    }>;
    const Adapter: AnyScene = (props) =>
      createElement(Renderer, {
        presentation: props.presentation,
        view: props.view,
        name: props.name,
        live: props.live,
        onDone: props.onComplete,
      });
    return { default: Adapter };
  });
}

export const SCENES: Record<PresentationKind, LazyExoticComponent<AnyScene>> = {
  roleReveal: lazy(() => import('./deck/DeckScene')) as unknown as LazyExoticComponent<AnyScene>,
  nightReport: legacy('nightReport'),
  verdict: legacy('verdict'),
  finale: legacy('finale'),
};

/** Названия сцен для страницы разработки. */
export const SCENE_TITLES: Record<PresentationKind, string> = {
  roleReveal: 'Колода — выдача роли',
  nightReport: 'Утро — итоги ночи',
  verdict: 'Вечер — приговор',
  finale: 'Финал',
};
