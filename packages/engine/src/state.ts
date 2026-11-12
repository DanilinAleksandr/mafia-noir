/**
 * Внутренние помощники: клонирование состояния, контекст шага, запись событий, ошибки.
 */
import { createRng, type Rng } from './rng';
import type {
  EventDataMap,
  EventPhase,
  EventType,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  StealthView,
  StepResult,
  Team,
  Visibility,
} from './types';

export type EngineErrorCode =
  | 'WRONG_PHASE'
  | 'DECISION_PENDING'
  | 'NO_DECISION'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_DEAD'
  | 'INVALID_ACTION'
  | 'INVALID_TARGET'
  | 'INVALID_CONFIG'
  | 'INVALID_COMPOSITION';

/** Ошибка ввода: действие нельзя выполнить в текущем состоянии. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

/** Глубокая копия JSON-значения. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Контекст одного шага: черновик состояния, события шага и генератор случайных чисел. */
export interface Ctx {
  state: GameState;
  events: GameEvent[];
  rng: Rng;
}

/** Начать шаг: входное состояние копируется и дальше не трогается. */
export function begin(state: GameState): Ctx {
  const draft = clone(state);
  return { state: draft, events: [], rng: createRng(draft.rng) };
}

export function finish(ctx: Ctx): StepResult {
  ctx.state.rng = ctx.rng.state;
  return { state: ctx.state, events: ctx.events };
}

// ── видимость ──

export const ALL: Visibility = { all: true, teams: [], players: [] };
export const NOBODY: Visibility = { all: false, teams: [], players: [] };

export function toPlayers(...ids: PlayerId[]): Visibility {
  return { all: false, teams: [], players: ids };
}

export function toTeam(team: Team, ...extra: PlayerId[]): Visibility {
  return { all: false, teams: [team], players: extra };
}

/** Скрытный вид для всех. */
export function stealthAll(opts: { actors?: boolean; targets?: boolean; data?: string[] } = {}): StealthView {
  return {
    visibility: ALL,
    actors: opts.actors ?? false,
    targets: opts.targets ?? false,
    data: opts.data ?? [],
  };
}

// ── события ──

export interface EventInit<K extends EventType> {
  actors?: PlayerId[];
  targets?: PlayerId[];
  data: EventDataMap[K];
  visibility: Visibility;
  stealth?: StealthView | null;
  phase?: EventPhase;
}

export function emit<K extends EventType>(ctx: Ctx, type: K, init: EventInit<K>): void {
  const s = ctx.state;
  const event = {
    id: s.log.length + 1,
    round: s.round,
    phase: init.phase ?? s.phase,
    type,
    actors: init.actors ?? [],
    targets: init.targets ?? [],
    data: init.data,
    visibility: clone(init.visibility),
    stealth: init.stealth ? clone(init.stealth) : null,
  } as unknown as GameEvent;
  s.log.push(event);
  ctx.events.push(event);
}

// ── игроки ──

export function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const p = findPlayer(state, id);
  if (!p) throw new EngineError('UNKNOWN_PLAYER', `Игрок «${id}» не найден`);
  return p;
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}
