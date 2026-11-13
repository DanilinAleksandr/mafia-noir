/**
 * EventPresenter — единая точка, через которую идут все визуальные реакции на события партии.
 *
 * Хранилище сообщает сюда о каждом новом снимке партии. Presenter решает, что показать
 * («представление»: раздача ролей, итоги ночи, приговор, финал), и держит их очередь.
 * Отрисовкой занимается PresenterHost по реестру рендереров (renderers.tsx): сейчас это простые
 * экраны с анимацией, на этапе 4 — кинематографичные сцены. Логика «когда и что показать»
 * при этом не меняется.
 *
 * Когда игрок досмотрел итоги ночи или приговор, presenter сообщает об этом наружу (`onDone`),
 * и хранилище отправляет серверу `ready`.
 */
import type { GameResult, PlayerId, ViewEvent } from '@mafia/engine';
import type { GameSnapshot, Scene } from '@mafia/protocol';
import { type Report, digest, lastPhaseMarker, scenesOfRound, segment } from './digest';

export type Presentation =
  | { id: number; kind: 'roleReveal' }
  | { id: number; kind: 'nightReport'; round: number; report: Report; step: number | null }
  | { id: number; kind: 'verdict'; round: number; report: Report; step: number | null }
  | { id: number; kind: 'finale'; result: GameResult };

export type PresentationKind = Presentation['kind'];

export interface PresenterInput {
  game: GameSnapshot;
  /** Весь журнал этого клиента. */
  events: readonly ViewEvent[];
  scenes: readonly Scene[];
  /** Новые события из этого сообщения (при `welcome` — пусто). */
  fresh: readonly ViewEvent[];
  /** Первый снимок после входа или переподключения. */
  initial: boolean;
  /** Шаг, на котором этот клиент уже отправил «готов». */
  readyStep: number;
  /** Ведущий-наблюдатель: ему отчёты не показываются, он видит журнал целиком. */
  narrator: boolean;
  /** Роль этой партии уже показывали (после обновления страницы не показывать снова). */
  roleSeen: boolean;
}

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;
type Draft = Distribute<Presentation>;

export class Presenter {
  private queue: Presentation[] = [];
  private seq = 1;
  /** Для каких шагов уже поставлены отчёты. */
  private presentedSteps = new Set<number>();
  private finaleShown = false;
  private listeners = new Set<() => void>();

  constructor(private readonly onDone: (presentation: Presentation) => void = () => {}) {}

  /** Текущее представление (голова очереди). */
  get current(): Presentation | null {
    return this.queue[0] ?? null;
  }

  get size(): number {
    return this.queue.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Новая партия или возврат в лобби: всё забыть. */
  reset(): void {
    this.queue = [];
    this.presentedSteps.clear();
    this.finaleShown = false;
    this.emit();
  }

  /** Новый снимок партии. */
  update(input: PresenterInput): void {
    const { game } = input;
    const me: PlayerId | null = game.view.you?.id ?? null;
    let changed = false;

    // раздача ролей: в начале партии (или после обновления страницы, пока роль не просмотрена)
    const started = input.fresh.some((e) => e.type === 'gameStarted');
    // первая ночь, а хода ещё нет (у мирных `ready` бывает true и без хода — смотрим на отправленное)
    const firstNight =
      game.stage === 'night' && game.view.round === 1 && Object.keys(game.view.night?.submitted ?? {}).length === 0;
    if (me && !input.narrator && (started || (input.initial && firstNight && !input.roleSeen))) {
      if (!this.queue.some((p) => p.kind === 'roleReveal')) {
        this.push({ kind: 'roleReveal' });
        changed = true;
      }
    }

    if (!input.narrator) {
      if (game.stage === 'morning' && !this.presentedSteps.has(game.step) && input.readyStep !== game.step) {
        this.presentedSteps.add(game.step);
        this.push(this.nightReport(input, me, game.step));
        changed = true;
      } else if (game.stage === 'evening' && !this.presentedSteps.has(game.step) && input.readyStep !== game.step) {
        this.presentedSteps.add(game.step);
        this.push(this.verdict(input, me, game.step));
        changed = true;
      }
    }

    if (game.stage === 'ended' && !this.finaleShown) {
      this.finaleShown = true;
      // последний отрезок партии: ночь или день, которыми она закончилась (только вживую)
      if (!input.initial && !input.narrator) {
        const draft =
          lastPhaseMarker(input.events) === 'nightStarted'
            ? this.nightReport(input, me, null)
            : this.verdict(input, me, null);
        this.push(draft);
      }
      if (game.view.result) this.push({ kind: 'finale', result: game.view.result });
      changed = true;
    }

    if (changed) this.emit();
  }

  /** Показать ещё раз итоги текущего утра или вечера (без повторного «готов»). */
  replay(input: Pick<PresenterInput, 'game' | 'events' | 'scenes'>): void {
    const me = input.game.view.you?.id ?? null;
    const full = { ...input, fresh: [], initial: false, readyStep: -1, narrator: false, roleSeen: true };
    if (input.game.stage === 'morning') this.push(this.nightReport(full, me, null));
    else if (input.game.stage === 'evening') this.push(this.verdict(full, me, null));
    else return;
    this.emit();
  }

  /** Показать карточку роли (по кнопке «Моя роль» показывается не отсюда — это для повторной раздачи). */
  showRole(): void {
    this.push({ kind: 'roleReveal' });
    this.emit();
  }

  /** Игрок досмотрел представление. */
  complete(id: number): void {
    const index = this.queue.findIndex((p) => p.id === id);
    if (index === -1) return;
    const [done] = this.queue.splice(index, 1);
    this.emit();
    if (done) this.onDone(done);
  }

  private nightReport(input: PresenterInput, me: PlayerId | null, step: number | null): Draft {
    const events = segment(input.events, 'nightStarted');
    const round = events.find((e) => e.phase === 'night')?.round ?? input.game.view.round;
    return {
      kind: 'nightReport',
      round,
      step,
      report: digest(events, { me, scenes: scenesOfRound(input.scenes, round), night: true }),
    };
  }

  private verdict(input: PresenterInput, me: PlayerId | null, step: number | null): Draft {
    const events = segment(input.events, 'dayStarted');
    const round = events[0]?.round ?? Math.max(1, input.game.view.round - 1);
    return { kind: 'verdict', round, step, report: digest(events, { me }) };
  }

  private push(draft: Draft): void {
    this.queue.push({ ...draft, id: this.seq++ } as Presentation);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
