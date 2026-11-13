import { type ReactNode, createContext, useContext, useSyncExternalStore } from 'react';
import type { RoomStore, RoomViewState } from './roomStore';

const RoomStoreContext = createContext<RoomStore | null>(null);

export function RoomStoreProvider({ store, children }: { store: RoomStore; children: ReactNode }) {
  return <RoomStoreContext.Provider value={store}>{children}</RoomStoreContext.Provider>;
}

export function useStore(): RoomStore {
  const store = useContext(RoomStoreContext);
  if (!store) throw new Error('RoomStore не передан');
  return store;
}

/** Состояние комнаты целиком (перерисовка на любое изменение — снимки маленькие). */
export function useRoomState(): RoomViewState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
