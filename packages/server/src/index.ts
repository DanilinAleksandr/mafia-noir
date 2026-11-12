/**
 * Worker: маршрутизация запросов.
 *
 *   POST /api/rooms            создать комнату
 *   GET  /api/rooms/:code      краткие сведения о комнате
 *   GET  /api/rooms/:code/ws   WebSocket комнаты
 *   GET  /, /r/:code           отладочная страница
 *
 * Вся работа с комнатой — в Durable Object `Room`; Worker только находит нужный объект.
 */
import {
  ERROR_MESSAGES,
  checkCreateRoom,
  generateRoomCode,
  normalizeRoomCode,
} from '@mafia/protocol';
import type { CreateRoomResponse, ErrorCode } from '@mafia/protocol';
import { randomBytes } from './crypto';
import { DEBUG_PAGE } from './debug-page';
import { type Env, Room, errorResponse } from './room';

export { Room };

/** API открыт для любого источника: авторизация — токеном в сообщении, а не куками. */
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const MAX_BODY_CHARS = 2000;

function fail(code: ErrorCode, status: number): Response {
  return errorResponse(code, status, CORS);
}

function roomStub(env: Env, code: string): DurableObjectStub<Room> {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return fail('TOO_LARGE', 413);
    body = JSON.parse(text);
  } catch {
    return fail('BAD_MESSAGE', 400);
  }
  const checked = checkCreateRoom(body);
  if (!checked.ok) return fail(checked.code, 400);

  // код случаен; на редкий случай совпадения с существующей комнатой — несколько попыток
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode(randomBytes);
    const created = await roomStub(env, code).createRoom({ code, ...checked.value });
    if (created) {
      const response: CreateRoomResponse = { code, memberId: created.memberId, token: created.token };
      return Response.json(response, { status: 201, headers: CORS });
    }
  }
  return fail('INTERNAL', 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/rooms') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'POST') return new Response('Метод не поддерживается', { status: 405, headers: CORS });
      return createRoom(request, env);
    }

    const match = /^\/api\/rooms\/([^/]+)(\/ws)?$/.exec(path);
    if (match) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'GET') return new Response('Метод не поддерживается', { status: 405, headers: CORS });
      const code = normalizeRoomCode(decodeURIComponent(match[1] as string));
      if (!code) return fail('ROOM_NOT_FOUND', 404);
      const stub = roomStub(env, code);
      if (match[2]) return stub.fetch(request);
      const info = await stub.info();
      return info ? Response.json(info, { headers: CORS }) : fail('ROOM_NOT_FOUND', 404);
    }

    if (request.method === 'GET' && (path === '/' || /^\/r\/[^/]+\/?$/.test(path))) {
      return new Response(DEBUG_PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(ERROR_MESSAGES.ROOM_NOT_FOUND, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
