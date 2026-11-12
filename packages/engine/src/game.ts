/**
 * Создание игры: состав, раздача ролей, первая ночь.
 */
import { generateComposition } from './composition';
import { resolveConfig } from './config';
import { createRng, seedToState } from './rng';
import { hasPassive, isRoleId, teamOf } from './roles';
import { ALL, EngineError, type Ctx, emit, finish, toPlayers, toTeam } from './state';
import type { GameConfigInput, GameState, PlayerId, PlayerInit, RoleId, StepResult } from './types';

/**
 * Создать игру.
 *
 * Роли раздаются одним из трёх способов:
 *   - у каждого игрока задана `role` — берётся как есть (ручная раздача, тесты; баланс не проверяется);
 *   - в конфиге задан `composition.preset` — список проверяется и перемешивается;
 *   - иначе состав генерируется по квотам и перемешивается.
 *
 * Порядок игроков во входном массиве — это порядок мест за столом.
 * Один и тот же seed при тех же входных данных всегда даёт ту же игру.
 */
export function createGame(
  config: GameConfigInput,
  players: readonly PlayerInit[],
  seed: string | number,
): StepResult {
  const cfg = resolveConfig(config);
  if (!Array.isArray(players) || players.length === 0) {
    throw new EngineError('INVALID_CONFIG', 'Нужен непустой список игроков');
  }
  const ids = new Set<PlayerId>();
  for (const p of players) {
    if (typeof p.id !== 'string' || p.id === '') throw new EngineError('INVALID_CONFIG', 'У игрока пустой id');
    if (ids.has(p.id)) throw new EngineError('INVALID_CONFIG', `Повторяющийся id игрока: «${p.id}»`);
    ids.add(p.id);
  }

  const rng = createRng(seedToState(seed));
  const explicit = players.filter((p) => p.role !== undefined).length;
  let roles: RoleId[];
  if (explicit === players.length) {
    roles = players.map((p) => {
      if (!isRoleId(p.role)) throw new EngineError('INVALID_CONFIG', `Неизвестная роль: «${String(p.role)}»`);
      return p.role;
    });
  } else if (explicit > 0) {
    throw new EngineError('INVALID_CONFIG', 'Роль должна быть задана либо у всех игроков, либо ни у кого');
  } else {
    const composition = generateComposition(players.length, cfg, `${seed}/composition`);
    if (!composition.ok) {
      throw new EngineError(
        'INVALID_COMPOSITION',
        `Не удалось собрать состав: ${composition.errors.map((e) => e.message).join('; ')}`,
      );
    }
    roles = rng.shuffle(composition.roles);
  }

  const state: GameState = {
    version: 1,
    config: cfg,
    rng: rng.state,
    phase: 'night',
    round: 1,
    players: players.map((p, seat) => {
      const role = roles[seat] as RoleId;
      return {
        id: p.id,
        name: p.name,
        seat,
        role,
        team: teamOf(role, cfg.rules),
        alive: true,
        death: null,
        revealed: false,
        uses: {},
        last: {},
        armor: hasPassive(role, 'armor'),
        vetoUsed: false,
      };
    }),
    night: { actions: {}, blocked: [], silenced: [], blessed: [] },
    day: null,
    pending: [],
    transition: null,
    lovers: [],
    personalWinners: [],
    log: [],
    result: null,
  };

  const ctx: Ctx = { state, events: [], rng };
  emit(ctx, 'gameStarted', { data: { playerCount: players.length }, visibility: ALL, phase: 'setup' });
  for (const p of state.players) {
    emit(ctx, 'roleAssigned', {
      targets: [p.id],
      data: { role: p.role },
      visibility: toPlayers(p.id),
      phase: 'setup',
    });
  }
  const black = state.players.filter((p) => p.team === 'black');
  if (black.length > 0) {
    const teamRoles: Record<PlayerId, RoleId> = {};
    for (const p of black) teamRoles[p.id] = p.role;
    emit(ctx, 'teamRevealed', {
      targets: black.map((p) => p.id),
      data: { roles: teamRoles },
      visibility: toTeam('black'),
      phase: 'setup',
    });
  }
  emit(ctx, 'nightStarted', { data: {}, visibility: ALL });
  return finish(ctx);
}
