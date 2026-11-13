/**
 * Маршруты клиента — без библиотек: их всего четыре.
 *   /            главная
 *   /create      создание комнаты
 *   /join        вход по коду
 *   /r/КОД       комната (вход по ссылке, лобби, игра)
 *   /roles       справочник ролей
 */
import { normalizeRoomCode } from '@mafia/protocol';
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'join'; code: string | null }
  | { name: 'room'; code: string }
  | { name: 'roles' }
  /** Только в разработке: витрина сцен. */
  | { name: 'devScenes' };

export function parseRoute(pathname: string, search = ''): Route {
  const room = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (room) {
    const code = normalizeRoomCode(decodeURIComponent(room[1] as string));
    return code ? { name: 'room', code } : { name: 'join', code: null };
  }
  if (pathname === '/create') return { name: 'create' };
  if (pathname === '/join') return { name: 'join', code: normalizeRoomCode(new URLSearchParams(search).get('code')) };
  if (pathname === '/roles') return { name: 'roles' };
  if (import.meta.env.DEV && pathname === '/dev/scenes') return { name: 'devScenes' };
  return { name: 'home' };
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (snapshot() === path) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [pathname, search = ''] = path.split('?');
  return parseRoute(pathname ?? '/', search ? `?${search}` : '');
}
