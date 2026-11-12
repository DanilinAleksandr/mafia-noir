/**
 * Помощники для тестов: маленькая изменяемая обёртка над чистыми функциями движка,
 * чтобы сценарии читались как рассказ.
 */
import {
  type AbilityId,
  type Decision,
  type EventType,
  type GameConfigInput,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
  type RoleId,
  type Rules,
  ROLE_IDS,
  castVote,
  createGame,
  createRng,
  currentDecision,
  nightOptions,
  resolveNight,
  resolveVote,
  seedToState,
  submitDecision,
  submitNightAction,
  viewFor,
} from '../src/index';

/** Ссылка на игрока: id («p3») или роль («doctor» — первый игрок с этой ролью, «mafia#2» — второй). */
export type Ref = string;

export type EventOf<K extends EventType> = Extract<GameEvent, { type: K }>;

export class Sim {
  state: GameState;
  /** События последнего шага. */
  last: GameEvent[] = [];

  constructor(roles: RoleId[], opts: { rules?: Partial<Rules>; seed?: string | number } = {}) {
    const players = roles.map((role, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}`, role }));
    const created = createGame({ rules: opts.rules }, players, opts.seed ?? 'test');
    this.state = created.state;
    this.last = created.events;
  }

  /** Превратить ссылку в id игрока. */
  id(ref: Ref): PlayerId {
    if (/^p\d+$/.test(ref)) return ref;
    const [role, index] = ref.split('#');
    const found = this.state.players.filter((p) => p.role === role);
    const player = found[index ? Number(index) - 1 : 0];
    if (!player) throw new Error(`В игре нет игрока «${ref}»`);
    return player.id;
  }

  player(ref: Ref): PlayerState {
    const id = this.id(ref);
    return this.state.players.find((p) => p.id === id) as PlayerState;
  }

  alive(ref: Ref): boolean {
    return this.player(ref).alive;
  }

  private apply(result: { state: GameState; events: GameEvent[] }): GameEvent[] {
    this.state = result.state;
    this.last = result.events;
    return result.events;
  }

  /** Ночная способность. */
  act(actor: Ref, ability: AbilityId, ...targets: Ref[]): this {
    this.apply(
      submitNightAction(this.state, this.id(actor), {
        kind: 'ability',
        ability,
        targets: targets.map((t) => this.id(t)),
      }),
    );
    return this;
  }

  /** Отказ от способности этой ночью. */
  pass(actor: Ref): this {
    this.apply(submitNightAction(this.state, this.id(actor), { kind: 'pass' }));
    return this;
  }

  /** Голос мафии. */
  mafia(voter: Ref, target: Ref | null): this {
    this.apply(
      submitNightAction(this.state, this.id(voter), {
        kind: 'mafiaVote',
        target: target === null ? null : this.id(target),
      }),
    );
    return this;
  }

  /** Разрешить ночь. */
  night(): GameEvent[] {
    return this.apply(resolveNight(this.state));
  }

  /** Дневной голос. */
  vote(voter: Ref, target: Ref | null): this {
    this.apply(castVote(this.state, this.id(voter), target === null ? null : this.id(target)));
    return this;
  }

  /** Все живые (кроме самой цели) голосуют против цели. */
  voteAll(target: Ref): this {
    const targetId = this.id(target);
    for (const p of this.state.players) {
      if (p.alive && p.id !== targetId) this.vote(p.id, targetId);
    }
    return this;
  }

  /** Подвести итог голосования. */
  tally(): GameEvent[] {
    return this.apply(resolveVote(this.state));
  }

  /** День без казни: никто не голосует. */
  skipDay(): GameEvent[] {
    return this.tally();
  }

  /** Отложенное решение. Цель можно задавать ссылкой (id или роль). */
  decide(actor: Ref, decision: Decision): GameEvent[] {
    const resolved: Decision =
      'target' in decision && decision.target !== null
        ? ({ ...decision, target: this.id(decision.target) } as Decision)
        : decision;
    return this.apply(submitDecision(this.state, this.id(actor), resolved));
  }

  /** События последнего шага нужного типа. */
  ev<K extends EventType>(type: K): EventOf<K>[] {
    return this.last.filter((e): e is EventOf<K> => e.type === type);
  }

  /** События всей игры нужного типа. */
  all<K extends EventType>(type: K): EventOf<K>[] {
    return this.state.log.filter((e): e is EventOf<K> => e.type === type);
  }

  view(ref: Ref | null) {
    return viewFor(this.state, ref === null ? null : this.id(ref));
  }
}

/** Заморозить объект целиком: любая попытка изменить его в строгом режиме бросит исключение. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ───────────────────────────── случайная игра ─────────────────────────────

export interface RandomGameHooks {
  /** Вызывается после каждого шага с новым состоянием. */
  onState?: (state: GameState, step: string) => void;
  /**
   * Вызывается, когда один игрок отправил действие (ночное или голос):
   * состояние до, состояние после, кто действовал и что это было.
   */
  onSubmit?: (before: GameState, after: GameState, actor: PlayerId, kind: 'ability' | 'mafiaVote' | 'pass' | 'vote') => void;
}

/**
 * Сыграть случайную игру до конца. Все решения принимаются генератором с данным seed,
 * поэтому игра полностью воспроизводима.
 */
export function playRandomGame(
  seed: string | number,
  config: GameConfigInput = {},
  playerCount?: number,
  hooks: RandomGameHooks = {},
  maxRounds = 40,
): GameState {
  const rng = createRng(seedToState(`driver:${seed}`));
  const n = playerCount ?? 5 + rng.int(9);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}` }));
  let state = createGame(config, players, seed).state;
  hooks.onState?.(state, 'created');

  const settleDecisions = (): void => {
    for (let guard = 0; guard < 50; guard++) {
      const head = currentDecision(state);
      if (!head) return;
      let decision: Decision;
      if (head.kind === 'hunterShot') {
        decision = { kind: 'hunterShot', target: rng.next() < 0.8 ? rng.pick(head.options) : null };
      } else if (head.kind === 'bomberBlast') {
        decision = { kind: 'bomberBlast', target: rng.pick(head.options) };
      } else {
        decision = { kind: 'judgeVeto', veto: rng.next() < 0.5 };
      }
      state = submitDecision(state, head.playerId, decision).state;
      hooks.onState?.(state, `decision:${head.kind}`);
    }
    throw new Error('Очередь решений не опустела');
  };

  while (state.phase !== 'ended' && state.round <= maxRounds) {
    if (state.phase === 'night') {
      for (const p of state.players.filter((x) => x.alive)) {
        const options = nightOptions(state, p.id);
        if (!options) continue;
        if (options.abilities.length > 0) {
          const before = state;
          if (rng.next() < 0.85) {
            const option = rng.pick(options.abilities);
            const targets = rng.shuffle(option.candidates).slice(0, option.targets);
            state = submitNightAction(state, p.id, { kind: 'ability', ability: option.id, targets }).state;
            hooks.onSubmit?.(before, state, p.id, 'ability');
          } else {
            state = submitNightAction(state, p.id, { kind: 'pass' }).state;
            hooks.onSubmit?.(before, state, p.id, 'pass');
          }
        }
        if (options.mafiaVote) {
          const before = state;
          const target = rng.next() < 0.9 ? rng.pick(options.mafiaVote.candidates) : null;
          state = submitNightAction(state, p.id, { kind: 'mafiaVote', target }).state;
          hooks.onSubmit?.(before, state, p.id, 'mafiaVote');
        }
        hooks.onState?.(state, 'nightAction');
      }
      state = resolveNight(state).state;
      hooks.onState?.(state, 'nightResolved');
      settleDecisions();
    } else {
      // день: возможно два круга голосования
      for (let stage = 0; stage < 2 && state.phase === 'day' && state.pending.length === 0; stage++) {
        const round = state.round;
        const candidates = state.day?.candidates ?? state.players.filter((x) => x.alive).map((x) => x.id);
        for (const p of state.players.filter((x) => x.alive)) {
          const pool = candidates.filter((c) => c !== p.id);
          const target = pool.length > 0 && rng.next() < 0.85 ? rng.pick(pool) : null;
          const before = state;
          state = castVote(state, p.id, target).state;
          hooks.onSubmit?.(before, state, p.id, 'vote');
          hooks.onState?.(state, 'vote');
        }
        state = resolveVote(state).state;
        hooks.onState?.(state, 'voteResolved');
        settleDecisions();
        if (state.round !== round) break;
      }
    }
  }
  return state;
}

/** Независимый от движка «оракул»: чьи роли зритель вправе знать. */
export function allowedToKnow(state: GameState, viewerId: PlayerId | null): Set<PlayerId> {
  const all = new Set(state.players.map((p) => p.id));
  if (state.phase === 'ended') return all;
  const viewer = state.players.find((p) => p.id === viewerId) ?? null;
  const rules = state.config.rules;
  if (viewer && !viewer.alive && rules.deadSeeAllRoles) return all;

  const known = new Set<PlayerId>();
  for (const p of state.players) {
    if (!p.alive && rules.revealRoleOnDeath) known.add(p.id);
    if (state.personalWinners.includes(p.id)) known.add(p.id);
    if (viewer && p.id === viewer.id) known.add(p.id);
    if (viewer && viewer.team === 'black' && p.team === 'black') known.add(p.id);
  }
  if (viewer) {
    for (const e of state.log) {
      if (e.type !== 'roleLearned') continue;
      const actor = state.players.find((p) => p.id === e.actors[0]);
      const own = e.actors.includes(viewer.id);
      const fromTeam = actor?.role === 'consigliere' && viewer.team === 'black';
      if (own || fromTeam) for (const t of e.targets) known.add(t);
    }
  }
  return known;
}

/**
 * Проверить, что представление зрителя не содержит чужих секретов.
 * Возвращает список найденных утечек (пустой — всё хорошо).
 */
export function findLeaks(state: GameState, viewerId: PlayerId | null): string[] {
  const leaks: string[] = [];
  const view = viewFor(state, viewerId);
  const known = allowedToKnow(state, viewerId);

  for (const vp of view.players) {
    if (!known.has(vp.id) && (vp.role !== null || vp.team !== null)) {
      leaks.push(`роль/команда ${vp.id} видна зрителю ${viewerId}`);
    }
  }
  // названия ролей, которых зритель знать не должен, не встречаются в представлении нигде
  const knownRoles = new Set(state.players.filter((p) => known.has(p.id)).map((p) => p.role));
  const hiddenRoles = new Set(state.players.filter((p) => !known.has(p.id)).map((p) => p.role));
  const json = JSON.stringify(view);
  for (const role of ROLE_IDS) {
    if (hiddenRoles.has(role) && !knownRoles.has(role) && json.includes(`"${role}"`)) {
      leaks.push(`в представлении зрителя ${viewerId} встречается скрытая роль «${role}»`);
    }
  }
  return leaks;
}
