/**
 * @mafia/engine — игровой движок «Мафии».
 * Чистые функции, неизменяемое состояние, детерминированность по seed.
 */
export * from './types';

export { createGame } from './game';
export {
  generateComposition,
  validateComposition,
  defaultBlackCount,
  defaultNeutralMax,
  CATEGORY_LABELS,
  type CompositionIssue,
  type CompositionIssueCode,
  type CompositionResult,
} from './composition';
export { DEFAULT_RULES, MIN_PLAYERS, resolveConfig } from './config';

export { nightOptions, submitNightAction, allNightActionsIn, pendingNightActors, resolveNight } from './night';
export { castVote, allVotesIn, resolveVote } from './day';
export { currentDecision, submitDecision, resolvePendingDefault } from './flow';
export { checkWin } from './win';
export { viewFor, projectEvent, projectEvents } from './view';

export { ROLES, ROLE_LIST, isRoleId, hasPassive, teamOf, categoryOf, winOf, findAbility } from './roles';
export { EngineError, type EngineErrorCode } from './state';
export { createRng, seedToState, rngStep, type Rng } from './rng';
