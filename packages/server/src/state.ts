/**
 * Состояние комнаты, которое хранит Durable Object, и константы сервера.
 * Всё состояние — один JSON-объект под ключом `room`.
 */
import type { GameState } from '@mafia/engine';
import type { ChatMessage, MemberId, RoomSettings, RoomStage } from '@mafia/protocol';
import type { PasswordHash } from './crypto';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const LIMITS_SERVER = {
  /** Комната удаляется после такого простоя. */
  idleMs: 6 * HOUR,
  /** Хост, отключившийся дольше этого времени, теряет права. */
  hostGraceMs: 2 * MINUTE,
  /** Сколько ждать «готов» от клиентов утром и вечером. */
  syncMs: 15 * SECOND,
  /** Неверных паролей с одного адреса за окно — до блокировки. */
  attemptsPerIp: 5,
  /** Неверных паролей на всю комнату за окно — до блокировки новых входов. */
  attemptsPerRoom: 30,
  attemptsWindowMs: 10 * MINUTE,
  attemptsLockMs: 10 * MINUTE,
  /** Одновременных соединений с комнатой (включая ещё не вошедших). */
  maxSockets: 60,
  /** Сообщений чата мафии, хранимых за партию. */
  chatHistory: 200,
  /** Не больше стольких сообщений от одного участника за окно. */
  rateCount: 40,
  rateWindowMs: 10 * SECOND,
} as const;

export interface Member {
  id: MemberId;
  name: string;
  /** SHA-256 от токена переподключения. Сам токен есть только у клиента. */
  tokenHash: string;
  joinedAt: number;
}

export interface Attempts {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

/** Версия формата состояния комнаты. Комнаты другого формата считаются несуществующими. */
export const ROOM_STATE_VERSION = 2;

export interface RoomState {
  v: typeof ROOM_STATE_VERSION;
  code: string;
  createdAt: number;
  /** Последняя активность: по ней считается простой. */
  lastActivityAt: number;
  password: PasswordHash;
  hostId: MemberId;
  /** С какого момента хост не в сети; null — в сети. */
  hostOfflineSince: number | null;
  /** Участники в порядке входа (он же порядок мест за столом). */
  members: Member[];
  nextMemberSeq: number;
  settings: RoomSettings;
  stage: RoomStage;
  game: GameState | null;
  /** Участники текущей партии (id совпадают с id игроков движка). */
  players: MemberId[];
  /** Номер рассылки: растёт с каждой рассылкой `room` или `game`. */
  rev: number;
  /** Номер шага партии: растёт при каждом разрешении (ночь, голосование, решение, начало дня). */
  step: number;
  /**
   * Синхронизация перед следующей фазой: утром (итоги ночи) и вечером (приговор).
   * Кто уже готов и когда игра пойдёт дальше сама. null — синхронизации нет.
   */
  sync: { kind: 'morning' | 'evening'; ready: MemberId[]; deadline: number } | null;
  /** Когда текущая стадия закончится по таймеру; null — таймера нет. */
  stageDeadline: number | null;
  chat: ChatMessage[];
  chatSeq: number;
  /** Счётчики неверных паролей: `ip:<адрес>` и `room`. */
  attempts: Record<string, Attempts>;
  /** Когда проверить простой комнаты. */
  idleCheckAt: number;
  /** На какое время сейчас заведён будильник (чтобы не переставлять его зря). */
  alarmAt: number | null;
}

/** Что сервер помнит о соединении (переживает спячку объекта). */
export interface SocketAttachment {
  /** Участник, под которым вошло соединение; null — ещё не вошло. */
  m: MemberId | null;
  ip: string;
}
