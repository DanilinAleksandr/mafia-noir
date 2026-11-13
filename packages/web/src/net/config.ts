/**
 * Адрес сервера. По умолчанию — тот же источник, с которого открыт клиент: в разработке Vite
 * проксирует `/api` на локальный `wrangler dev` (см. vite.config.ts). Для собранного клиента
 * на другом адресе задаётся VITE_SERVER_URL (например, https://mafia.example.workers.dev).
 */
const configured = (import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/+$/, '');

function origin(): string {
  return configured || window.location.origin;
}

export function apiUrl(path: string): string {
  return `${origin()}${path}`;
}

export function roomWsUrl(code: string): string {
  const url = new URL(`/api/rooms/${encodeURIComponent(code)}/ws`, origin());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** Ссылка-приглашение в комнату (на сам клиент, а не на сервер). */
export function inviteUrl(code: string): string {
  return `${window.location.origin}/r/${code}`;
}
