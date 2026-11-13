/**
 * Контракт сцены. Сцена — изолированный компонент: получает данные через props и вызывает
 * onComplete, когда игрок её досмотрел. Сцены грузятся лениво (scenes/registry.ts).
 */
import type { ClientView, DisplayMode } from '@mafia/protocol';
import type { NameOf } from '../lib/describe';
import type { Presentation, PresentationKind } from '../presenter/presenter';
import type { Prefs, Quality } from '../settings/prefs';

export interface SceneProps<P extends Presentation = Presentation> {
  presentation: P;
  /** Представление игрока (только его данные). */
  view: ClientView;
  name: NameOf;
  /** Режим показа событий партии: от него зависит, кого можно рисовать в личных сценах. */
  display: DisplayMode;
  prefs: Prefs;
  quality: Quality;
  /** Шаг ещё актуален: по завершении уйдёт «готов». */
  live: boolean;
  onComplete: () => void;
}

export type SceneOf<K extends PresentationKind> = SceneProps<Extract<Presentation, { kind: K }>>;
