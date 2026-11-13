/**
 * Worker: маршрутизация запросов.
 *
 *   POST /api/rooms            создать комнату (с ограничением частоты — Gate)
 *   GET  /api/rooms/:code      краткие сведения о комнате
 *   GET  /api/rooms/:code/ws   WebSocket комнаты (только со своего Origin)
 *   GET  /api/debug            отладочная страница — только в разработке (`__DEV__`)
 *
 * Всё остальное (клиент) раздаёт Workers Static Assets из `packages/web/dist` по тому же адресу:
 * Worker вызывается только для `/api/*` (`assets.run_worker_first` в wrangler.jsonc).
 * Клиент и API на одном источнике — CORS не нужен и не включён.
 */
import { ERROR_MESSAGES, checkCreateRoom, generateRoomCode, normalizeRoomCode } from '@mafia/protocol';
import type { CreateRoomResponse, ErrorCode } from '@mafia/protocol';
import { randomBytes } from './crypto';
import { Gate } from './gate';
import { type Env, Room, errorResponse } from './room';

export { Gate, Room };

/**
 * Флаг сборки: в `wrangler dev` — true (`--define __DEV__:true`), при деплое и в тестах — false.
 * В разработке включает отладочную страницу (при false её нет в бандле) и разрешает любой Origin:
 * телефон в Wi-Fi открывает Vite по адресу вида 192.168.…, а Vite проксирует на 127.0.0.1.
 */
declare const __DEV__: boolean;

const MAX_BODY_CHARS = 2000;

function fail(code: ErrorCode, status: number, headers: Record<string, string> = {}): Response {
  return errorResponse(code, status, headers);
}

function roomStub(env: Env, code: string): DurableObjectStub<Room> {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

/** Адрес клиента. Cloudflare ставит заголовок всегда; без него запрос не из интернета. */
function clientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP');
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * WebSocket открывается только со страниц того же адреса. Браузер всегда шлёт Origin, и чужая
 * страница не сможет подключить игрока к комнате от его имени. Без Origin приходят не браузеры
 * (боты, скрипты) — им Origin ничего бы не доказал. Локально Vite (5173) проксирует на wrangler
 * (8787): там разрешены источники с localhost.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || __DEV__) return true;
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return false;
  }
  const to = new URL(request.url);
  if (from.host === to.host) return true;
  return isLocalHost(from.hostname) && isLocalHost(to.hostname);
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_CHARS * 4) return null;
  const text = await request.text();
  return text.length > MAX_BODY_CHARS ? null : text;
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    const text = await readBody(request);
    if (text === null) return fail('TOO_LARGE', 413);
    body = JSON.parse(text);
  } catch {
    return fail('BAD_MESSAGE', 400);
  }
  const checked = checkCreateRoom(body);
  if (!checked.ok) return fail(checked.code, 400);

  // не больше N комнат с адреса и всего — до хеширования пароля и до создания объекта
  const gate = env.GATE.get(env.GATE.idFromName('gate'));
  const verdict = await gate.allowRoom(clientIp(request));
  if (!verdict.ok) return fail('TOO_MANY_ROOMS', 429, { 'Retry-After': String(verdict.retryAfter) });

  // код случаен; на редкий случай совпадения с существующей комнатой — несколько попыток
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode(randomBytes);
    const created = await roomStub(env, code).createRoom({ code, ...checked.value });
    if (created) {
      const response: CreateRoomResponse = { code, memberId: created.memberId, token: created.token };
      return Response.json(response, { status: 201 });
    }
  }
  return fail('INTERNAL', 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/rooms') {
      if (request.method !== 'POST') return new Response('Метод не поддерживается', { status: 405 });
      return createRoom(request, env);
    }

    const match = /^\/api\/rooms\/([^/]+)(\/ws)?$/.exec(path);
    if (match) {
      if (request.method !== 'GET') return new Response('Метод не поддерживается', { status: 405 });
      const code = normalizeRoomCode(decodeURIComponent(match[1] as string));
      if (!code) return fail('ROOM_NOT_FOUND', 404);
      const stub = roomStub(env, code);
      if (match[2]) {
        if (!originAllowed(request)) return fail('BAD_ORIGIN', 403);
        return stub.fetch(request);
      }
      const info = await stub.info();
      return info ? Response.json(info) : fail('ROOM_NOT_FOUND', 404);
    }

    if (__DEV__ && request.method === 'GET' && path === '/api/debug') {
      const { DEBUG_PAGE } = await import('./debug-page');
      return new Response(DEBUG_PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(ERROR_MESSAGES.ROOM_NOT_FOUND, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
