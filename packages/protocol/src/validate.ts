/**
 * Проверка входящих сообщений клиента. Всё, что пришло из сети, считается недоверенным:
 * сервер работает только с результатом `parseClientMessage`.
 */
import { ROLE_LIST } from '@mafia/engine';
import type { AbilityId, Decision, NightAction } from '@mafia/engine';
import type { ErrorCode } from './errors';
import { ERROR_MESSAGES } from './errors';
import type { ClientMessage, HostMode } from './messages';
import { HOST_MODES, LIMITS, checkSettingsPatch } from './settings';

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string; re: number | null };

const ABILITY_IDS = new Set<string>(ROLE_LIST.flatMap((role) => role.abilities.map((a) => a.id)));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isStep(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

/** Диапазоны кодов символов (включительно). Заданы числами, чтобы в исходнике не было невидимых символов. */
type Ranges = readonly (readonly [number, number])[];

/** Управляющие и невидимые символы, включая «перевёртыши» направления текста. */
const INVISIBLE: Ranges = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

/** То же, но перевод строки и табуляция в чате разрешены. */
const INVISIBLE_IN_CHAT: Ranges = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

function strip(text: string, ranges: Ranges): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (!ranges.some(([from, to]) => code >= from && code <= to)) out += ch;
  }
  return out;
}

/**
 * Привести имя к каноническому виду: без управляющих символов, без лишних пробелов.
 * Возвращает null, если имя пустое или длиннее допустимого.
 */
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 400) return null;
  const name = strip(input, INVISIBLE).replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  return length >= 1 && length <= LIMITS.nameMax ? name : null;
}

export function isValidPassword(input: unknown): input is string {
  return typeof input === 'string' && input.length >= 1 && input.length <= LIMITS.passwordMax;
}

/** Текст чата: обрезанные пробелы, без управляющих символов; null — пусто или слишком длинно. */
export function normalizeChatText(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > LIMITS.chatMax * 4) return null;
  const text = strip(input, INVISIBLE_IN_CHAT).trim();
  const length = [...text].length;
  return length >= 1 && length <= LIMITS.chatMax ? text : null;
}

function checkNightAction(input: unknown): NightAction | null {
  if (!isObject(input)) return null;
  if (input.kind === 'pass') return { kind: 'pass' };
  if (input.kind === 'mafiaVote') {
    if (input.target !== null && !isId(input.target)) return null;
    return { kind: 'mafiaVote', target: input.target };
  }
  if (input.kind === 'ability') {
    if (typeof input.ability !== 'string' || !ABILITY_IDS.has(input.ability)) return null;
    const targets = input.targets;
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 2 || !targets.every(isId)) return null;
    return { kind: 'ability', ability: input.ability as AbilityId, targets: [...(targets as string[])] };
  }
  return null;
}

function checkDecision(input: unknown): Decision | null {
  if (!isObject(input)) return null;
  if (input.kind === 'hunterShot') {
    if (input.target !== null && !isId(input.target)) return null;
    return { kind: 'hunterShot', target: input.target };
  }
  if (input.kind === 'bomberBlast') {
    return isId(input.target) ? { kind: 'bomberBlast', target: input.target } : null;
  }
  if (input.kind === 'judgeVeto') {
    return typeof input.veto === 'boolean' ? { kind: 'judgeVeto', veto: input.veto } : null;
  }
  return null;
}

/** Разобрать и проверить сообщение клиента (строку JSON). */
export function parseClientMessage(raw: unknown): Parsed<ClientMessage> {
  const bad = (
    code: ErrorCode = 'BAD_MESSAGE',
    detail?: string,
    re: number | null = null,
  ): Parsed<ClientMessage> => ({ ok: false, code, message: detail ?? ERROR_MESSAGES[code], re });

  if (typeof raw !== 'string') return bad();
  if (raw.length > LIMITS.messageChars) return bad('TOO_LARGE');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return bad();
  }
  if (!isObject(data) || typeof data.t !== 'string') return bad();

  let id: number | undefined;
  if (data.id !== undefined) {
    if (!isStep(data.id)) return bad();
    id = data.id;
  }
  const re = id ?? null;
  const done = (message: ClientMessage): Parsed<ClientMessage> => ({
    ok: true,
    value: id === undefined ? message : { ...message, id },
  });

  switch (data.t) {
    case 'hello': {
      if (typeof data.v !== 'number' || !Number.isInteger(data.v)) return bad('BAD_MESSAGE', undefined, re);
      if (data.token !== undefined) {
        if (typeof data.token !== 'string' || data.token.length < 1 || data.token.length > LIMITS.tokenMax) {
          return bad('BAD_TOKEN', undefined, re);
        }
        return done({ t: 'hello', v: data.v, token: data.token });
      }
      if (typeof data.name !== 'string' || data.name.length > 200) return bad('BAD_NAME', undefined, re);
      if (typeof data.password !== 'string' || data.password.length > LIMITS.passwordMax) {
        return bad('BAD_PASSWORD', undefined, re);
      }
      return done({ t: 'hello', v: data.v, name: data.name, password: data.password });
    }
    case 'settings': {
      const checked = checkSettingsPatch(data.patch);
      if (!checked.ok) return bad('BAD_SETTINGS', checked.message, re);
      return done({ t: 'settings', patch: checked.value });
    }
    case 'kick':
    case 'transferHost':
      if (!isId(data.memberId)) return bad('BAD_MESSAGE', undefined, re);
      return done({ t: data.t, memberId: data.memberId });
    case 'leave':
    case 'start':
    case 'toLobby':
      return done({ t: data.t });
    case 'night': {
      const action = checkNightAction(data.action);
      if (!action) return bad('BAD_MESSAGE', 'Некорректное ночное действие', re);
      return done({ t: 'night', action });
    }
    case 'vote':
      if (data.target !== null && !isId(data.target)) return bad('BAD_MESSAGE', undefined, re);
      return done({ t: 'vote', target: data.target });
    case 'decision': {
      const decision = checkDecision(data.decision);
      if (!decision) return bad('BAD_MESSAGE', 'Некорректное решение', re);
      return done({ t: 'decision', decision });
    }
    case 'ready':
    case 'advance':
      if (!isStep(data.step)) return bad('BAD_MESSAGE', undefined, re);
      return done({ t: data.t, step: data.step });
    case 'chat': {
      const text = normalizeChatText(data.text);
      if (text === null) return bad('BAD_MESSAGE', `Сообщение должно быть от 1 до ${LIMITS.chatMax} символов`, re);
      return done({ t: 'chat', text });
    }
    default:
      return bad('BAD_MESSAGE', `Неизвестный тип сообщения: ${data.t.slice(0, 40)}`, re);
  }
}

/** Проверить тело запроса на создание комнаты. */
export function checkCreateRoom(
  input: unknown,
): { ok: true; value: { name: string; password: string; hostMode: HostMode } } | { ok: false; code: ErrorCode } {
  if (!isObject(input)) return { ok: false, code: 'BAD_MESSAGE' };
  const name = normalizeName(input.name);
  if (name === null) return { ok: false, code: 'BAD_NAME' };
  if (!isValidPassword(input.password)) return { ok: false, code: 'BAD_PASSWORD' };
  const hostMode = input.hostMode ?? 'player';
  if (!HOST_MODES.includes(hostMode as HostMode)) return { ok: false, code: 'BAD_MESSAGE' };
  return { ok: true, value: { name, password: input.password, hostMode: hostMode as HostMode } };
}
