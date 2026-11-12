/**
 * День: тайное одновременное голосование.
 *
 * - побеждает кандидат с наибольшей суммой голосов (голос Мэра считается за два);
 * - при равенстве — одно переголосование среди набравших поровну; снова равенство — никто не уходит;
 * - защищённого Священником казнить нельзя;
 * - Судья один раз за игру может отменить итог;
 * - казнь Шута и Подрывника — их личная победа; Подрывник забирает одного из голосовавших против.
 */
import { advance, execute } from './flow';
import { hasPassive } from './roles';
import {
  ALL,
  EngineError,
  NOBODY,
  alivePlayers,
  begin,
  emit,
  finish,
  getPlayer,
  stealthAll,
  toPlayers,
} from './state';
import type { GameState, PlayerId, StepResult } from './types';

function assertDayOpen(state: GameState): void {
  if (state.phase !== 'day' || !state.day) throw new EngineError('WRONG_PHASE', 'Сейчас не день');
  if (state.transition !== null || state.pending.length > 0) {
    throw new EngineError('DECISION_PENDING', 'Голосование завершено: игра ждёт решения игрока');
  }
}

/** Отдать голос. targetId = null — воздержаться. До подсчёта голос можно менять. */
export function castVote(state: GameState, voterId: PlayerId, targetId: PlayerId | null): StepResult {
  assertDayOpen(state);
  const voter = getPlayer(state, voterId);
  if (!voter.alive) throw new EngineError('PLAYER_DEAD', 'Мёртвые не голосуют');
  const day = state.day as NonNullable<GameState['day']>;
  if (targetId !== null) {
    const target = getPlayer(state, targetId);
    if (!target.alive) throw new EngineError('INVALID_TARGET', 'Нельзя голосовать против мёртвого');
    if (targetId === voterId) throw new EngineError('INVALID_TARGET', 'Нельзя голосовать против себя');
    if (day.candidates && !day.candidates.includes(targetId)) {
      throw new EngineError('INVALID_TARGET', 'При переголосовании можно выбрать только из набравших поровну');
    }
  }
  const ctx = begin(state);
  (ctx.state.day as NonNullable<GameState['day']>).votes[voterId] = targetId;
  return finish(ctx);
}

/** Все ли живые проголосовали (или воздержались). */
export function allVotesIn(state: GameState): boolean {
  if (state.phase !== 'day' || !state.day || state.transition !== null || state.pending.length > 0) return false;
  const votes = state.day.votes;
  return alivePlayers(state).every((p) => votes[p.id] !== undefined);
}

/** Подвести итог голосования. Неголосовавшие считаются воздержавшимися. */
export function resolveVote(state: GameState): StepResult {
  assertDayOpen(state);
  const ctx = begin(state);
  const s = ctx.state;
  const day = s.day as NonNullable<GameState['day']>;
  const bySeat = (a: PlayerId, b: PlayerId): number => getPlayer(s, a).seat - getPlayer(s, b).seat;

  const tally: Record<PlayerId, number> = {};
  const ballots: Record<PlayerId, PlayerId | null> = {};
  let abstained = 0;
  for (const voter of alivePlayers(s)) {
    const vote = day.votes[voter.id] ?? null;
    ballots[voter.id] = vote;
    day.votes[voter.id] = vote;
    if (vote === null) {
      abstained++;
      continue;
    }
    tally[vote] = (tally[vote] ?? 0) + (hasPassive(voter.role, 'doubleVote') ? 2 : 1);
  }
  const top = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally)
    .filter((id) => tally[id] === top)
    .sort(bySeat);
  const outcome = leaders.length === 0 ? 'noVotes' : leaders.length === 1 ? 'condemned' : 'tie';

  emit(ctx, 'voteResult', {
    targets: leaders,
    data: { stage: day.stage, tally, abstained, outcome },
    visibility: ALL,
  });
  emit(ctx, 'ballotsRevealed', {
    data: { ballots },
    visibility: s.config.rules.votingMode === 'secret' ? NOBODY : ALL,
  });

  const endDay = (): void => {
    s.transition = 'toNight';
    advance(ctx);
  };

  if (outcome === 'noVotes') {
    emit(ctx, 'noExecution', { data: { reason: 'noVotes' }, visibility: ALL });
    endDay();
    return finish(ctx);
  }
  if (outcome === 'tie') {
    if (day.stage === 'vote') {
      day.stage = 'revote';
      day.candidates = leaders;
      day.votes = {};
      emit(ctx, 'revoteStarted', { targets: leaders, data: {}, visibility: ALL });
    } else {
      emit(ctx, 'noExecution', { targets: leaders, data: { reason: 'tie' }, visibility: ALL });
      endDay();
    }
    return finish(ctx);
  }

  const condemned = leaders[0] as PlayerId;
  if (day.protected.includes(condemned)) {
    const priests = s.players.filter((p) => p.last.bless?.round === s.round && p.last.bless.targets.includes(condemned));
    emit(ctx, 'executionPrevented', {
      actors: priests.map((p) => p.id),
      targets: [condemned],
      data: { reason: 'blessing' },
      visibility: toPlayers(...priests.map((p) => p.id)),
      stealth: stealthAll({ targets: true, data: ['reason'] }),
    });
    endDay();
    return finish(ctx);
  }

  // Судьи (если есть неиспользованная отмена) решают по очереди, по местам
  const judges = alivePlayers(s).filter((p) => hasPassive(p.role, 'veto') && !p.vetoUsed);
  if (judges.length > 0) {
    day.condemned = condemned;
    for (const judge of judges) s.pending.push({ kind: 'judgeVeto', playerId: judge.id, condemned });
    return finish(ctx);
  }

  execute(ctx, condemned);
  return finish(ctx);
}
