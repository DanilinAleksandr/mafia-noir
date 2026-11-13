/**
 * Фикстуры для компонентных тестов: снимки строятся настоящим движком (createGame + viewFor),
 * поэтому они такие же, какие прислал бы сервер.
 */
import {
  createGame,
  projectEvents,
  resolveNight,
  submitNightAction,
  viewFor,
} from '@mafia/engine';
import type { GameState, PlayerId, RoleId, ViewEvent } from '@mafia/engine';
import { defaultRoomSettings } from '@mafia/protocol';
import type { GameSnapshot, GameStage, RoomSnapshot } from '@mafia/protocol';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RoomStoreProvider } from '../store/context';
import { RoomStore, type RoomViewState } from '../store/roomStore';

export const NAMES = ['Аня', 'Борис', 'Вера', 'Гоша', 'Даша', 'Егор'];

export function newGame(roles: RoleId[]): GameState {
  const players = roles.map((role, i) => ({ id: `m${i + 1}`, name: NAMES[i] ?? `Игрок ${i + 1}`, role }));
  return createGame({}, players, 'seed-test').state;
}

export function snapshot(
  state: GameState,
  viewer: PlayerId | null,
  stage: GameStage,
  extra: Partial<GameSnapshot> = {},
  seeAll = false,
): GameSnapshot {
  const { events: _events, ...view } = viewFor(state, viewer, { seeAll });
  return {
    rev: 1,
    step: 1,
    stage,
    deadline: null,
    serverTime: Date.now(),
    display: 'stealth',
    composition: null,
    progress: null,
    view,
    ...extra,
  };
}

export function eventsFor(state: GameState, viewer: PlayerId | null, seeAll = false): ViewEvent[] {
  return projectEvents(state, state.log, viewer, { seeAll });
}

export function room(members: number, hostId = 'm1', patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    rev: 1,
    code: 'K7MPQ',
    stage: 'lobby',
    hostId,
    members: Array.from({ length: members }, (_, i) => ({
      id: `m${i + 1}`,
      name: NAMES[i] ?? `Игрок ${i + 1}`,
      online: i !== members - 1,
      isHost: `m${i + 1}` === hostId,
      playing: true,
    })),
    settings: defaultRoomSettings(),
    presetHidden: false,
    startIssues: [],
    startWarnings: [],
    ...patch,
  };
}

export function storeWith(state: Partial<RoomViewState>): RoomStore {
  const store = new RoomStore('K7MPQ');
  store.inject({ status: 'online', ...state });
  return store;
}

export function renderWith(store: RoomStore, ui: ReactElement) {
  return render(<RoomStoreProvider store={store}>{ui}</RoomStoreProvider>);
}

/** Сыграть ночь: все пропускают, мафия убивает `victim`. */
export function nightKill(state: GameState, victim: PlayerId): GameState {
  let s = state;
  for (const p of s.players) {
    if (!p.alive) continue;
    if (p.team === 'black') s = submitNightAction(s, p.id, { kind: 'mafiaVote', target: victim }).state;
    else s = submitNightAction(s, p.id, { kind: 'pass' }).state;
  }
  return resolveNight(s).state;
}
