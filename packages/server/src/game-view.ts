/**
 * Чистые функции, которые собирают из состояния комнаты то, что уходит клиентам.
 */
import { ROLE_IDS } from '@mafia/engine';
import type { EventType, GameEvent, GameState, RoleId } from '@mafia/engine';
import type { GameStage, RoleCount, Scene } from '@mafia/protocol';
import type { RoomState } from './state';

/** Стадия партии с точки зрения сервера. */
export function stageOf(room: Pick<RoomState, 'game' | 'morning'>): GameStage {
  const game = room.game as GameState;
  if (game.phase === 'ended') return 'ended';
  if (game.pending.length > 0) return 'decision';
  if (room.morning) return 'morning';
  return game.phase;
}

/** Список ролей в партии без владельцев, в порядке каталога (не в порядке мест). */
export function compositionOf(game: GameState): RoleCount[] {
  const counts = new Map<RoleId, number>();
  for (const p of game.players) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);
  return ROLE_IDS.filter((role) => counts.has(role)).map((role) => ({ role, count: counts.get(role) as number }));
}

/** События ночи, которые в режиме «Кино» показываются всем как обезличенные сцены. */
const SCENE_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'loversLinked',
  'blocked',
  'blessed',
  'mafiaTargetChosen',
  'saved',
  'covered',
  'silenced',
  'checked',
  'roleLearned',
  'visitorsSeen',
  'teamsCompared',
]);

/**
 * Сцены для режима «Кино»: тип события и роль действовавшего.
 * Игроков, целей и результатов в сцене нет — по ней нельзя узнать, кто какую роль играет.
 */
export function scenesOf(game: GameState, events: readonly GameEvent[]): Scene[] {
  const scenes: Scene[] = [];
  for (const event of events) {
    if (event.phase !== 'night' || !SCENE_TYPES.has(event.type)) continue;
    const actor = event.type === 'mafiaTargetChosen' ? undefined : game.players.find((p) => p.id === event.actors[0]);
    scenes.push({ id: event.id, round: event.round, type: event.type, role: actor ? actor.role : null });
  }
  return scenes;
}
