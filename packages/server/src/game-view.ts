/**
 * Чистые функции, которые собирают из состояния комнаты то, что уходит клиентам.
 */
import { ROLE_IDS, findAbility } from '@mafia/engine';
import type { AbilityId, GameEvent, GameState, PlayerId, RoleId } from '@mafia/engine';
import type { DisplayMode, GameStage, RoleCount, Scene } from '@mafia/protocol';
import type { RoomState } from './state';

/** Стадия партии с точки зрения сервера. */
export function stageOf(room: Pick<RoomState, 'game' | 'sync' | 'discussion'>): GameStage {
  const game = room.game as GameState;
  if (game.phase === 'ended') return 'ended';
  if (game.pending.length > 0) return 'decision';
  if (room.sync) return room.sync.kind;
  if (game.phase === 'day' && room.discussion) return 'discussion';
  return game.phase;
}

/** Список ролей в партии без владельцев, в порядке каталога (не в порядке мест). */
export function compositionOf(game: GameState): RoleCount[] {
  const counts = new Map<RoleId, number>();
  for (const p of game.players) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
  return ROLE_IDS.filter((role) => counts.has(role)).map((role) => ({ role, count: counts.get(role) as number }));
}

/** Способности, которые в режиме «Скрытный» сценами не становятся: они выдали бы информационные роли. */
export const STEALTH_HIDDEN_ABILITIES: readonly AbilityId[] = ['check', 'investigate', 'scout', 'compare', 'stay'];

/**
 * Личные сцены игрока: какие роли ночью подействовали на него.
 *
 * Сцена строится по событию `abilityUsed`, если игрок — цель способности, а не её автор.
 * В сцену попадает роль применившего (в «Скрытном» — null), но не его id. Нападения (Маньяк,
 * яд Ведьмы) и убийство мафии сценами не становятся никогда: убийца не раскрывается.
 * Наблюдение Патрульного — тоже: он следит со стороны и к игроку не приходит.
 *
 * @param events события, по которым строить сцены (шаг или весь журнал)
 */
export function personalScenes(
  game: GameState,
  events: readonly GameEvent[],
  playerId: PlayerId,
  display: DisplayMode = 'cinema',
): Scene[] {
  const scenes: Scene[] = [];
  for (const event of events) {
    if (event.type !== 'abilityUsed') continue;
    const actorId = event.actors[0];
    if (actorId === undefined || actorId === playerId || !event.targets.includes(playerId)) continue;
    const actor = game.players.find((p) => p.id === actorId);
    const ability = actor ? findAbility(actor.role, event.data.ability) : undefined;
    if (!actor || !ability || ability.step === 'attack' || !ability.visit) continue;
    if (display === 'stealth' && STEALTH_HIDDEN_ABILITIES.includes(ability.id)) continue;
    const saved = game.log.some(
      (e) =>
        e.type === 'saved' &&
        e.round === event.round &&
        e.phase === 'night' &&
        e.actors[0] === actorId &&
        e.targets[0] === playerId,
    );
    scenes.push({
      id: event.id,
      round: event.round,
      ability: event.data.ability,
      role: display === 'stealth' ? null : actor.role,
      saved,
    });
  }
  return scenes;
}
