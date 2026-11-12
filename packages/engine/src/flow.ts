/**
 * Общий ход игры: смерти и их цепочки, отложенные решения, смена фаз, конец игры.
 */
import { hasPassive, winOf } from './roles';
import {
  ALL,
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
  DeathCause,
  Decision,
  GameResult,
  GameState,
  PendingDecision,
  PlayerId,
  RoleId,
  StealthView,
  StepResult,
  ViewDecision,
  Visibility,
} from './types';
import { checkWin } from './win';

export interface Kill {
  victim: PlayerId;
  cause: DeathCause;
  killer: PlayerId | null;
}

/** Скрытный вид события «спасён»: анонимное объявление всем, если это включено правилами. */
export function saveStealth(state: GameState): StealthView | null {
  return state.config.rules.announceSaves ? stealthAll() : null;
}

/**
 * Замкнуть список смертей по цепочкам: Бомж гибнет вместе с хозяином, влюблённый — вместе с парой.
 * Ничего не меняет, только возвращает упорядоченный список.
 *
 * @param hoboHosts хозяин → Бомжи, ночующие у него этой ночью
 */
export function closeDeaths(state: GameState, direct: Kill[], hoboHosts: Map<PlayerId, PlayerId[]>): Kill[] {
  const out: Kill[] = [];
  const dead = new Set<PlayerId>();
  const queue = [...direct];
  while (queue.length > 0) {
    const kill = queue.shift() as Kill;
    const victim = findPlayer(state, kill.victim);
    if (!victim || !victim.alive || dead.has(kill.victim)) continue;
    dead.add(kill.victim);
    out.push(kill);
    for (const hobo of hoboHosts.get(kill.victim) ?? []) {
      queue.push({ victim: hobo, cause: 'hoboWithHost', killer: null });
    }
    for (const [a, b] of state.lovers) {
      if (a === kill.victim) queue.push({ victim: b, cause: 'loverGrief', killer: null });
      if (b === kill.victim) queue.push({ victim: a, cause: 'loverGrief', killer: null });
    }
  }
  return out;
}

/** Применить смерти: пометить погибших, записать события, поставить в очередь выстрелы Охотников. */
export function applyDeaths(ctx: Ctx, kills: Kill[]): void {
  const s = ctx.state;
  const rules = s.config.rules;
  for (const kill of kills) {
    const p = getPlayer(s, kill.victim);
    if (!p.alive) continue;
    p.alive = false;
    p.death = { round: s.round, phase: s.phase, cause: kill.cause };

    let visibility: Visibility;
    if (kill.cause === 'mafiaKill') visibility = toTeam('black');
    else if (kill.killer && (kill.cause === 'maniacKill' || kill.cause === 'witchPoison')) {
      visibility = toPlayers(kill.killer);
    } else if (rules.revealDeathCause) visibility = ALL;
    else visibility = toPlayers(...(kill.killer ? [kill.killer] : []));

    emit(ctx, 'death', {
      actors: kill.killer ? [kill.killer] : [],
      targets: [p.id],
      data: { cause: kill.cause },
      visibility,
      stealth: visibility.all
        ? null
        : stealthAll({ targets: true, data: rules.revealDeathCause ? ['cause'] : [] }),
    });
    if (rules.revealRoleOnDeath) revealRole(ctx, p.id);

    if (hasPassive(p.role, 'lastShot')) {
      // Любовница, заблокировавшая Охотника ночью, лишает его и предсмертного выстрела этой ночью
      const blocked = s.phase === 'night' && (s.night?.blocked.includes(p.id) ?? false);
      if (!blocked) s.pending.push({ kind: 'hunterShot', playerId: p.id });
    }
  }
}

function revealRole(ctx: Ctx, id: PlayerId): void {
  const p = getPlayer(ctx.state, id);
  if (p.revealed) return;
  p.revealed = true;
  emit(ctx, 'roleRevealed', { targets: [id], data: { role: p.role }, visibility: ALL });
}

/**
 * Удар вне ночного разрешения (выстрел Охотника, взрыв Подрывника).
 * Лечение уже не действует, но щит Героя срабатывает.
 */
export function strike(ctx: Ctx, attacker: PlayerId, targetId: PlayerId, cause: DeathCause): void {
  const s = ctx.state;
  const target = getPlayer(s, targetId);
  if (target.armor) {
    target.armor = false;
    emit(ctx, 'saved', {
      actors: [target.id],
      targets: [target.id],
      data: { by: 'armor', attack: cause },
      visibility: toPlayers(target.id),
      stealth: saveStealth(s),
    });
    return;
  }
  applyDeaths(ctx, closeDeaths(s, [{ victim: targetId, cause, killer: attacker }], new Map()));
}

/** Казнить приговорённого и продолжить игру. */
export function execute(ctx: Ctx, condemnedId: PlayerId): void {
  const s = ctx.state;
  const day = s.day;
  const voters = day
    ? Object.entries(day.votes)
        .filter(([, target]) => target === condemnedId)
        .map(([voter]) => voter)
    : [];
  if (day) day.condemned = null;
  const p = getPlayer(s, condemnedId);
  applyDeaths(ctx, closeDeaths(s, [{ victim: condemnedId, cause: 'execution', killer: null }], new Map()));

  if (winOf(p.role, s.config.rules) === 'executed') {
    s.personalWinners.push(p.id);
    const role: RoleId = p.role;
    p.revealed = true;
    emit(ctx, 'personalWin', { targets: [p.id], data: { role }, visibility: ALL });
  }
  if (hasPassive(p.role, 'blast')) {
    s.pending.push({ kind: 'bomberBlast', playerId: p.id, voters });
  }
  s.transition = 'toNight';
  advance(ctx);
}

// ───────────────────────────── отложенные решения ─────────────────────────────

/** Из кого может выбирать тот, от кого ждут решения. */
export function pendingOptions(state: GameState, pending: PendingDecision): PlayerId[] {
  switch (pending.kind) {
    case 'hunterShot':
      return alivePlayers(state)
        .filter((p) => p.id !== pending.playerId)
        .map((p) => p.id);
    case 'bomberBlast':
      return alivePlayers(state)
        .filter((p) => pending.voters.includes(p.id))
        .map((p) => p.id);
    case 'judgeVeto':
      return [];
  }
}

function pendingValid(state: GameState, pending: PendingDecision): boolean {
  switch (pending.kind) {
    case 'hunterShot':
    case 'bomberBlast':
      return pendingOptions(state, pending).length > 0;
    case 'judgeVeto': {
      const judge = findPlayer(state, pending.playerId);
      const condemned = findPlayer(state, pending.condemned);
      return Boolean(
        judge?.alive && !judge.vetoUsed && condemned?.alive && state.day?.condemned === pending.condemned,
      );
    }
  }
}

/** Решение, которого сейчас ждёт игра, или null. */
export function currentDecision(state: GameState): (ViewDecision & { playerId: PlayerId }) | null {
  const head = state.pending[0];
  if (!head || state.phase === 'ended') return null;
  return {
    kind: head.kind,
    playerId: head.playerId,
    options: pendingOptions(state, head),
    condemned: head.kind === 'judgeVeto' ? head.condemned : null,
  };
}

/** Принять решение игрока (выстрел Охотника, взрыв Подрывника, отмена Судьи). */
export function submitDecision(state: GameState, playerId: PlayerId, decision: Decision): StepResult {
  if (state.phase === 'ended') throw new EngineError('WRONG_PHASE', 'Игра уже закончилась');
  const head = state.pending[0];
  if (!head) throw new EngineError('NO_DECISION', 'Сейчас игра не ждёт ничьего решения');
  if (head.playerId !== playerId) throw new EngineError('NO_DECISION', 'Сейчас решение принимает другой игрок');
  if (head.kind !== decision.kind) {
    throw new EngineError('INVALID_ACTION', `Ожидается решение «${head.kind}», получено «${decision.kind}»`);
  }

  const ctx = begin(state);
  const s = ctx.state;
  const pending = s.pending[0] as PendingDecision;
  const options = pendingOptions(s, pending);

  if (decision.kind === 'hunterShot') {
    if (decision.target !== null && !options.includes(decision.target)) {
      throw new EngineError('INVALID_TARGET', 'В этого игрока стрелять нельзя');
    }
    s.pending.shift();
    if (decision.target !== null) strike(ctx, playerId, decision.target, 'hunterShot');
    advance(ctx);
  } else if (decision.kind === 'bomberBlast') {
    if (!options.includes(decision.target)) {
      throw new EngineError('INVALID_TARGET', 'Забрать можно только живого игрока, голосовавшего против');
    }
    s.pending.shift();
    strike(ctx, playerId, decision.target, 'bomberBlast');
    advance(ctx);
  } else {
    const condemned = (pending as Extract<PendingDecision, { kind: 'judgeVeto' }>).condemned;
    s.pending.shift();
    if (decision.veto) {
      getPlayer(s, playerId).vetoUsed = true;
      if (s.day) s.day.condemned = null;
      emit(ctx, 'voteCancelled', {
        actors: [playerId],
        targets: [condemned],
        data: {},
        visibility: toPlayers(playerId),
        stealth: stealthAll({ targets: true }),
      });
      s.transition = 'toNight';
      advance(ctx);
    } else {
      dropInvalidPending(s);
      const next = s.pending[0];
      const anotherJudge = next?.kind === 'judgeVeto' && next.condemned === condemned;
      if (!anotherJudge) execute(ctx, condemned);
    }
  }
  return finish(ctx);
}

/**
 * Решение по умолчанию для таймаута: Охотник не стреляет, Судья не отменяет,
 * Подрывник забирает случайного из голосовавших против.
 */
export function resolvePendingDefault(state: GameState): StepResult {
  const head = currentDecision(state);
  if (!head) throw new EngineError('NO_DECISION', 'Сейчас игра не ждёт ничьего решения');
  if (head.kind === 'hunterShot') return submitDecision(state, head.playerId, { kind: 'hunterShot', target: null });
  if (head.kind === 'judgeVeto') return submitDecision(state, head.playerId, { kind: 'judgeVeto', veto: false });
  // случайный выбор должен продвинуть ГСЧ состояния: тянем число здесь и сохраняем сдвиг
  const ctx = begin(state);
  const target = ctx.rng.pick(head.options);
  const advanced = finish(ctx).state;
  return submitDecision(advanced, head.playerId, { kind: 'bomberBlast', target });
}

function dropInvalidPending(state: GameState): void {
  while (state.pending.length > 0 && !pendingValid(state, state.pending[0] as PendingDecision)) {
    state.pending.shift();
  }
}

// ───────────────────────────── смена фаз ─────────────────────────────

/**
 * Продвинуть игру, когда очередной шаг завершён: если никто не должен принять решение,
 * проверить победу и перейти к следующей фазе.
 */
export function advance(ctx: Ctx): void {
  const s = ctx.state;
  if (s.phase === 'ended') return;
  dropInvalidPending(s);
  if (s.pending.length > 0) return;
  const result = checkWin(s);
  if (result) {
    endGame(ctx, result);
    return;
  }
  if (s.transition === 'toDay') startDay(ctx);
  else if (s.transition === 'toNight') startNight(ctx);
}

function startDay(ctx: Ctx): void {
  const s = ctx.state;
  const night = s.night;
  const stillAlive = (id: PlayerId): boolean => findPlayer(s, id)?.alive ?? false;
  s.day = {
    stage: 'vote',
    candidates: null,
    votes: {},
    silenced: (night?.silenced ?? []).filter(stillAlive),
    protected: (night?.blessed ?? []).filter(stillAlive),
    condemned: null,
  };
  s.night = null;
  s.phase = 'day';
  s.transition = null;
  emit(ctx, 'dayStarted', { data: {}, visibility: ALL });
}

function startNight(ctx: Ctx): void {
  const s = ctx.state;
  s.round += 1;
  s.day = null;
  s.night = { actions: {}, blocked: [], silenced: [], blessed: [] };
  s.phase = 'night';
  s.transition = null;
  emit(ctx, 'nightStarted', { data: {}, visibility: ALL });
}

function endGame(ctx: Ctx, result: GameResult): void {
  const s = ctx.state;
  s.phase = 'ended';
  s.transition = null;
  s.pending = [];
  s.result = result;
  const roles: Record<PlayerId, RoleId> = {};
  for (const p of s.players) {
    roles[p.id] = p.role;
    p.revealed = true;
  }
  emit(ctx, 'gameEnded', {
    targets: result.winners,
    data: { outcome: result.outcome, reason: result.reason, winners: result.winners, roles },
    visibility: ALL,
  });
}
