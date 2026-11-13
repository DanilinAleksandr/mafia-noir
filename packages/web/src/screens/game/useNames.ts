import { useCallback } from 'react';
import type { NameOf } from '../../lib/describe';
import { useRoomState } from '../../store/context';

/** Имя игрока по id: из представления партии, иначе из списка участников комнаты. */
export function useNames(): NameOf {
  const { game, room } = useRoomState();
  return useCallback(
    (id: string) =>
      game?.view.players.find((p) => p.id === id)?.name ?? room?.members.find((m) => m.id === id)?.name ?? '?',
    [game, room],
  );
}
