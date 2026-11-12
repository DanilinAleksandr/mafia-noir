/**
 * Ночь: приём действий и их разрешение.
 *
 * Порядок разрешения:
 *   1. Купидон (первая ночь)
 *   2. блокировки (Любовница)
 *   3. защиты (Доктор, зелье спасения Ведьмы, Телохранитель, Священник)
 *   4. атаки (мафия, Маньяк, зелье убийства Ведьмы)
 *   5. эффекты (Адвокат, Шантажист)
 *   6. информационные роли
 *   7. цепочки смертей (Бомж с хозяином, влюблённые), предсмертный выстрел Охотника
 *
 * Все действия одной ночи одновременны: убитый этой ночью всё равно успевает применить способность.
 */
import { advance, applyDeaths, closeDeaths, saveStealth, type Kill } from './flow';
import { ROLES, hasPassive } from './roles';
import {
  EngineError,
  type Ctx,
  alivePlayers,
  begin,
  emit,
  findPlayer,
  finish,
  getPlayer,
  stealthAll,
  toPlayers,
  toTeam,
} from './state';
import type {
  AbilityDef,
  AbilityOption,
  DeathCause,
  GameState,
  NightAction,
  NightEntry,
  NightOptions,
  PlayerId,
  PlayerState,
  SaveKind,
  StepResult,
} from './types';

function nightOpen(state: GameState): boolean {
  return state.phase === 'night' && state.night !== null && state.transition === null && state.pending.length === 0;
}

function assertNightOpen(state: GameState): void {
  if (state.phase !== 'night' || !state.night) throw new EngineError('WRONG_PHASE', 'Сейчас не ночь');
  if (state.transition !== null || state.pending.length > 0) {
    throw new EngineError('DECISION_PENDING', 'Ночь уже разрешена: игра ждёт решения игрока');
  }
}

/** Что игрок может сделать этой ночью. null — сейчас не ночь или игрок мёртв. */
export function nightOptions(state: GameState, playerId: PlayerId): NightOptions | null {
  if (!nightOpen(state)) return null;
  const p = findPlayer(state, playerId);
  if (!p || !p.alive) return null;
  const rules = state.config.rules;
  const alive = alivePlayers(state);
  const abilities: AbilityOption[] = [];

  for (const a of ROLES[p.role].abilities) {
    if (a.firstNightOnly && state.round !== 1) continue;
    const used = p.uses[a.id] ?? 0;
    if (a.uses !== null && used >= a.uses) continue;
    const allowSelf = a.id === 'heal' ? rules.doctorSelfHeal : a.self;
    const last = p.last[a.id];
    const banned = a.noRepeat && last && last.round === state.round - 1 ? last.targets : [];
    const candidates = alive
      .filter(
        (t) =>
          (allowSelf || t.id !== p.id) &&
          (a.filter !== 'blackOnly' || t.team === 'black') &&
          (a.filter !== 'notBlack' || t.team !== 'black') &&
          !banned.includes(t.id),
      )
      .map((t) => t.id);
    if (candidates.length < a.targets) continue;
    abilities.push({
      id: a.id,
      targets: a.targets,
      candidates,
      usesLeft: a.uses === null ? null : a.uses - used,
    });
  }

  const mafiaVote =
    p.team === 'black' ? { candidates: alive.filter((t) => t.team !== 'black').map((t) => t.id) } : null;
  return { abilities, mafiaVote };
}

/**
 * Принять ночное действие игрока. До разрешения ночи действие можно менять сколько угодно раз.
 * За ночь применяется одна способность; чёрные дополнительно голосуют за жертву.
 */
export function submitNightAction(state: GameState, playerId: PlayerId, action: NightAction): StepResult {
  assertNightOpen(state);
  const player = getPlayer(state, playerId);
  if (!player.alive) throw new EngineError('PLAYER_DEAD', 'Мёртвые ночью не действуют');
  const options = nightOptions(state, playerId) as NightOptions;

  const ctx = begin(state);
  const night = ctx.state.night as NonNullable<GameState['night']>;
  const entry: NightEntry = night.actions[playerId] ?? {};

  switch (action.kind) {
    case 'ability': {
      const option = options.abilities.find((o) => o.id === action.ability);
      if (!option) {
        throw new EngineError('INVALID_ACTION', `Способность «${action.ability}» вам сейчас недоступна`);
      }
      const targets = action.targets;
      if (!Array.isArray(targets) || targets.length !== option.targets) {
        throw new EngineError('INVALID_TARGET', `Нужно выбрать целей: ${option.targets}`);
      }
      if (new Set(targets).size !== targets.length) {
        throw new EngineError('INVALID_TARGET', 'Цели должны быть разными');
      }
      for (const t of targets) {
        if (!option.candidates.includes(t)) {
          throw new EngineError('INVALID_TARGET', `Игрока «${t}» выбрать нельзя`);
        }
      }
      entry.ability = { id: action.ability, targets: [...targets] };
      break;
    }
    case 'mafiaVote': {
      if (!options.mafiaVote) throw new EngineError('INVALID_ACTION', 'Вы не участвуете в голосовании мафии');
      if (action.target !== null && !options.mafiaVote.candidates.includes(action.target)) {
        throw new EngineError('INVALID_TARGET', `Игрока «${action.target}» мафия убить не может`);
      }
      entry.mafiaVote = action.target;
      break;
    }
    case 'pass':
      entry.ability = null;
      break;
    default:
      throw new EngineError('INVALID_ACTION', 'Неизвестное ночное действие');
  }

  night.actions[playerId] = entry;
  return finish(ctx);
}

/** Получено ли от игрока всё, что от него требуется этой ночью. */
export function entryComplete(options: NightOptions, entry: NightEntry | undefined): boolean {
  if (options.abilities.length > 0 && entry?.ability === undefined) return false;
  if (options.mafiaVote && entry?.mafiaVote === undefined) return false;
  return true;
}

/** Игроки, от которых ещё ждут ночного действия. Только для сервера: клиентам не показывать. */
export function pendingNightActors(state: GameState): PlayerId[] {
  if (!nightOpen(state)) return [];
  const night = state.night as NonNullable<GameState['night']>;
  return alivePlayers(state)
    .filter((p) => !entryComplete(nightOptions(state, p.id) as NightOptions, night.actions[p.id]))
    .map((p) => p.id);
}

/**
 * Сделал ли игрок ночной ход — включая «пустой» ход тех, кому делать нечего
 * (для них ходом считается `{ kind: 'pass' }`).
 * Нужен серверу, чтобы по скорости ответа нельзя было вычислить роль: ждут всех живых.
 */
export function nightMoveDone(state: GameState, playerId: PlayerId): boolean {
  if (!nightOpen(state)) return false;
  const options = nightOptions(state, playerId);
  if (!options) return false;
  const entry = (state.night as NonNullable<GameState['night']>).actions[playerId];
  return entry !== undefined && entryComplete(options, entry);
}

/** Сделали ли ход все живые игроки, включая «пустые» ходы. */
export function allNightMovesDone(state: GameState): boolean {
  return nightOpen(state) && alivePlayers(state).every((p) => nightMoveDone(state, p.id));
}

/** Все ли, кому есть что делать ночью, ответили (способность или отказ; голос мафии). */
export function allNightActionsIn(state: GameState): boolean {
  return nightOpen(state) && pendingNightActors(state).length === 0;
}

// ───────────────────────────── разрешение ─────────────────────────────

interface Act {
  actor: PlayerState;
  def: AbilityDef;
  targets: PlayerId[];
}

interface Attack {
  attacker: PlayerId;
  target: PlayerId;
  cause: DeathCause;
}

/** Разрешить ночь. Неответившие считаются отказавшимися. */
export function resolveNight(state: GameState): StepResult {
  assertNightOpen(state);
  const ctx = begin(state);
  const s = ctx.state;
  const night = s.night as NonNullable<GameState['night']>;
  const rules = s.config.rules;
  const bySeat = (a: PlayerId, b: PlayerId): number => getPlayer(s, a).seat - getPlayer(s, b).seat;

  // собрать применённые способности (в порядке мест)
  const acts: Act[] = [];
  for (const p of alivePlayers(s)) {
    const chosen = night.actions[p.id]?.ability;
    if (!chosen) continue;
    const def = ROLES[p.role].abilities.find((a) => a.id === chosen.id);
    if (def) acts.push({ actor: p, def, targets: chosen.targets });
  }
  const markUse = (act: Act): void => {
    act.actor.uses[act.def.id] = (act.actor.uses[act.def.id] ?? 0) + 1;
    act.actor.last[act.def.id] = { round: s.round, targets: [...act.targets] };
    emit(ctx, 'abilityUsed', {
      actors: [act.actor.id],
      targets: [...act.targets],
      data: { ability: act.def.id },
      visibility: toPlayers(act.actor.id),
    });
  };
  const ofStep = (list: Act[], step: AbilityDef['step']): Act[] => list.filter((a) => a.def.step === step);

  /** Визиты: [гость, хозяин]. */
  const visits: [PlayerId, PlayerId][] = [];
  const addVisits = (act: Act): void => {
    if (!act.def.visit) return;
    for (const t of act.targets) if (t !== act.actor.id) visits.push([act.actor.id, t]);
  };

  // ── 1. Купидон ──
  for (const act of ofStep(acts, 'link')) {
    const [a, b] = act.targets as [PlayerId, PlayerId];
    s.lovers.push([a, b]);
    markUse(act);
    addVisits(act);
    emit(ctx, 'loversLinked', {
      actors: [act.actor.id],
      targets: [a, b],
      data: {},
      visibility: toPlayers(act.actor.id),
      stealth: { visibility: toPlayers(a, b), actors: false, targets: true, data: [] },
    });
  }

  // ── 2. блокировки (все Любовницы действуют одновременно) ──
  const blocked = new Set<PlayerId>();
  for (const act of ofStep(acts, 'block')) {
    const target = act.targets[0] as PlayerId;
    blocked.add(target);
    markUse(act);
    addVisits(act);
    emit(ctx, 'blocked', {
      actors: [act.actor.id],
      targets: [target],
      data: {},
      visibility: toPlayers(act.actor.id),
      stealth: { visibility: toPlayers(target), actors: false, targets: true, data: [] },
    });
  }
  night.blocked = [...blocked].sort(bySeat);

  // дальше действуют только незаблокированные
  const live = acts.filter((a) => a.def.step !== 'link' && a.def.step !== 'block' && !blocked.has(a.actor.id));
  for (const act of live) {
    markUse(act);
    addVisits(act);
  }

  // ── 3. защиты ──
  const healed = new Map<PlayerId, { by: SaveKind; actor: PlayerId }>();
  const guards = new Map<PlayerId, PlayerId[]>();
  const blessed: PlayerId[] = [];
  for (const act of ofStep(live, 'protect')) {
    const target = act.targets[0] as PlayerId;
    if (act.def.id === 'heal') {
      healed.set(target, { by: 'heal', actor: act.actor.id });
    } else if (act.def.id === 'potionHeal') {
      // лечение Доктора имеет приоритет в отчёте, зелье всё равно потрачено
      if (!healed.has(target)) healed.set(target, { by: 'potion', actor: act.actor.id });
    } else if (act.def.id === 'guard') {
      guards.set(target, [...(guards.get(target) ?? []), act.actor.id]);
    } else if (act.def.id === 'bless') {
      blessed.push(target);
      emit(ctx, 'blessed', {
        actors: [act.actor.id],
        targets: [target],
        data: {},
        visibility: toPlayers(act.actor.id),
      });
    }
  }

  // ── 4. атаки ──
  const attacks: Attack[] = [];

  // мафия: голосование живых незаблокированных чёрных
  const voters = alivePlayers(s).filter((p) => p.team === 'black' && !blocked.has(p.id));
  const votes: Record<PlayerId, PlayerId | null> = {};
  const tally = new Map<PlayerId, number>();
  for (const v of voters) {
    const vote = night.actions[v.id]?.mafiaVote ?? null;
    votes[v.id] = vote;
    if (vote !== null && findPlayer(s, vote)?.alive) tally.set(vote, (tally.get(vote) ?? 0) + 1);
  }
  if (tally.size > 0) {
    const top = Math.max(...tally.values());
    const tied = [...tally.entries()]
      .filter(([, count]) => count === top)
      .map(([id]) => id)
      .sort(bySeat);
    let victim: PlayerId;
    let decidedBy: 'votes' | 'don' | 'random';
    if (tied.length === 1) {
      victim = tied[0] as PlayerId;
      decidedBy = 'votes';
    } else {
      const don = voters.find((v) => hasPassive(v.role, 'donTiebreak') && tied.includes(votes[v.id] as PlayerId));
      if (don) {
        victim = votes[don.id] as PlayerId;
        decidedBy = 'don';
      } else {
        victim = ctx.rng.pick(tied);
        decidedBy = 'random';
      }
    }
    // исполнитель — случайный из голосовавших за выбранную жертву; он и «приходит» к ней
    const killer = ctx.rng.pick(voters.filter((v) => votes[v.id] === victim)).id;
    visits.push([killer, victim]);
    attacks.push({ attacker: killer, target: victim, cause: 'mafiaKill' });
    emit(ctx, 'mafiaTargetChosen', {
      actors: [killer],
      targets: [victim],
      data: { votes, decidedBy },
      visibility: toTeam('black'),
    });
  }
  for (const act of ofStep(live, 'attack')) {
    attacks.push({
      attacker: act.actor.id,
      target: act.targets[0] as PlayerId,
      cause: act.def.id === 'potionKill' ? 'witchPoison' : 'maniacKill',
    });
  }

  const dying = new Map<PlayerId, Kill>();
  for (const attack of attacks) {
    let victim = attack.target;
    // Телохранитель закрывает собой: удар переходит на него
    const guard = (guards.get(victim) ?? []).find((g) => g !== attack.attacker);
    if (guard) {
      emit(ctx, 'saved', {
        actors: [guard],
        targets: [victim],
        data: { by: 'guard', attack: attack.cause },
        visibility: toPlayers(guard),
        stealth: saveStealth(s),
      });
      victim = guard;
    }
    if (dying.has(victim)) continue;
    const heal = healed.get(victim);
    if (heal) {
      emit(ctx, 'saved', {
        actors: [heal.actor],
        targets: [victim],
        data: { by: heal.by, attack: attack.cause },
        visibility: toPlayers(heal.actor),
        stealth: saveStealth(s),
      });
      continue;
    }
    const target = getPlayer(s, victim);
    if (target.armor) {
      target.armor = false;
      emit(ctx, 'saved', {
        actors: [victim],
        targets: [victim],
        data: { by: 'armor', attack: attack.cause },
        visibility: toPlayers(victim),
        stealth: saveStealth(s),
      });
      continue;
    }
    dying.set(victim, { victim, cause: attack.cause, killer: attack.attacker });
  }

  // кто погибнет этой ночью с учётом цепочек (применяется на шаге 7)
  const hoboHosts = new Map<PlayerId, PlayerId[]>();
  for (const act of live) {
    if (act.def.id !== 'stay') continue;
    const host = act.targets[0] as PlayerId;
    hoboHosts.set(host, [...(hoboHosts.get(host) ?? []), act.actor.id]);
  }
  const kills = closeDeaths(s, [...dying.values()], hoboHosts);
  const willDie = new Set(kills.map((k) => k.victim));

  // ── 5. эффекты ──
  const covered = new Set<PlayerId>();
  const silenced: PlayerId[] = [];
  for (const act of ofStep(live, 'effect')) {
    const target = act.targets[0] as PlayerId;
    if (act.def.id === 'cover') {
      covered.add(target);
      emit(ctx, 'covered', {
        actors: [act.actor.id],
        targets: [target],
        data: {},
        visibility: toTeam('black'),
      });
    } else if (act.def.id === 'silence') {
      silenced.push(target);
      emit(ctx, 'silenced', {
        actors: [act.actor.id],
        targets: [target],
        data: {},
        visibility: toTeam('black'),
        // погибшему этой ночью молчать уже незачем — объявление не нужно
        stealth: willDie.has(target) ? null : stealthAll({ targets: true }),
      });
    }
  }

  // ── 6. информационные роли ──
  const visitorsOf = (host: PlayerId, except: PlayerId): PlayerId[] =>
    [...new Set(visits.filter(([guest, h]) => h === host && guest !== except).map(([guest]) => guest))].sort(bySeat);
  const faction = (p: PlayerState): string => (p.team === 'neutral' ? `neutral:${p.id}` : p.team);

  for (const act of ofStep(live, 'info')) {
    const actor = act.actor.id;
    const target = getPlayer(s, act.targets[0] as PlayerId);
    switch (act.def.id) {
      case 'check': {
        let isMafia = target.team === 'black';
        if (target.role === 'don') isMafia = rules.commissionerSeesDonAsMafia;
        if (target.role === 'maniac') isMafia = rules.commissionerSeesManiacAsMafia;
        if (covered.has(target.id)) isMafia = false;
        emit(ctx, 'checked', {
          actors: [actor],
          targets: [target.id],
          data: { isMafia },
          visibility: toPlayers(actor),
        });
        break;
      }
      case 'investigate':
        emit(ctx, 'roleLearned', {
          actors: [actor],
          targets: [target.id],
          data: { role: target.role },
          visibility: toPlayers(actor),
        });
        break;
      case 'scout':
        emit(ctx, 'roleLearned', {
          actors: [actor],
          targets: [target.id],
          data: { role: target.role },
          visibility: toTeam('black'),
        });
        break;
      case 'compare': {
        const other = getPlayer(s, act.targets[1] as PlayerId);
        emit(ctx, 'teamsCompared', {
          actors: [actor],
          targets: [target.id, other.id],
          data: { sameTeam: faction(target) === faction(other) },
          visibility: toPlayers(actor),
        });
        break;
      }
      case 'watch':
      case 'stay':
        emit(ctx, 'visitorsSeen', {
          actors: [actor],
          targets: [target.id],
          data: { visitors: visitorsOf(target.id, actor) },
          visibility: toPlayers(actor),
        });
        break;
      default:
        break;
    }
  }

  // ── 7. смерти и цепочки ──
  applyDeaths(ctx, kills);

  night.silenced = silenced;
  night.blessed = blessed;
  s.transition = 'toDay';
  advance(ctx);
  return finish(ctx);
}
