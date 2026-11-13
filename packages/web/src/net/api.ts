/**
 * HTTP-часть протокола: создание комнаты и краткие сведения о ней.
 */
import { ERROR_MESSAGES, isErrorCode } from '@mafia/protocol';
import type { CreateRoomRequest, CreateRoomResponse, ErrorCode, RoomInfoResponse } from '@mafia/protocol';
import { t } from '../i18n';
import { apiUrl } from './config';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError('NETWORK', t.errors.network);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // тело не JSON — разберёмся по статусу
  }
  if (response.ok) return body as T;
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (error && isErrorCode(error.code)) {
    throw new ApiError(error.code, typeof error.message === 'string' ? error.message : ERROR_MESSAGES[error.code]);
  }
  throw new ApiError('INTERNAL', t.errors.unknown);
}

export function createRoom(request: CreateRoomRequest): Promise<CreateRoomResponse> {
  return call<CreateRoomResponse>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export function roomInfo(code: string): Promise<RoomInfoResponse> {
  return call<RoomInfoResponse>(`/api/rooms/${encodeURIComponent(code)}`);
}
