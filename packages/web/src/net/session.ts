/**
 * Сессии в комнатах: токен переподключения и имя.
 *
 * Токен этой вкладки лежит в sessionStorage (обновление страницы — переподключение под тем же
 * игроком), а копия — в localStorage, чтобы вернуться в игру после закрытия браузера.
 * Вкладка без своей сессии берёт сохранённую из localStorage. Если та же сессия открыта где-то
 * ещё, сервер закроет старое соединение (REPLACED) — экран предложит «Играть здесь».
 *
 * Хранится только то, что сервер выдал этому клиенту: код комнаты, id, имя и токен.
 */
export interface Session {
  code: string;
  memberId: string;
  name: string;
  token: string;
}

const TAB_KEY = 'mafia.session';
const SAVED_KEY = 'mafia.sessions';

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // приватный режим или переполнение: живём без сохранения
  }
}

function isSession(value: unknown): value is Session {
  const s = value as Session;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.code === 'string' &&
    typeof s.memberId === 'string' &&
    typeof s.name === 'string' &&
    typeof s.token === 'string'
  );
}

function savedMap(): Record<string, Session> {
  try {
    const parsed: unknown = JSON.parse(safeGet(localStorage, SAVED_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, Session> = {};
    for (const [code, value] of Object.entries(parsed)) if (isSession(value)) out[code] = value;
    return out;
  } catch {
    return {};
  }
}

/** Сессия этой вкладки для комнаты. */
export function tabSession(code: string): Session | null {
  try {
    const parsed: unknown = JSON.parse(safeGet(sessionStorage, TAB_KEY) ?? 'null');
    return isSession(parsed) && parsed.code === code ? parsed : null;
  } catch {
    return null;
  }
}

/** Сохранённая (на устройстве) сессия для комнаты. */
export function savedSession(code: string): Session | null {
  return savedMap()[code] ?? null;
}

/** Последняя сохранённая сессия — для кнопки «Вернуться в комнату» на главной. */
export function lastSession(): Session | null {
  const code = safeGet(localStorage, 'mafia.lastRoom');
  return code ? savedSession(code) : null;
}

export function storeSession(session: Session): void {
  safeSet(sessionStorage, TAB_KEY, JSON.stringify(session));
  const map = savedMap();
  map[session.code] = session;
  // храним не больше пяти комнат
  const codes = Object.keys(map);
  for (const code of codes.slice(0, Math.max(0, codes.length - 5))) delete map[code];
  safeSet(localStorage, SAVED_KEY, JSON.stringify(map));
  safeSet(localStorage, 'mafia.lastRoom', session.code);
}

/** Забыть сессию комнаты (исключили, вышли, комната закрыта, токен недействителен). */
export function forgetSession(code: string): void {
  if (tabSession(code)) safeSet(sessionStorage, TAB_KEY, null);
  const map = savedMap();
  delete map[code];
  safeSet(localStorage, SAVED_KEY, JSON.stringify(map));
  if (safeGet(localStorage, 'mafia.lastRoom') === code) safeSet(localStorage, 'mafia.lastRoom', null);
}

/** Сессия, с которой вкладка войдёт в комнату сама: своя или сохранённая на устройстве. */
export function sessionFor(code: string): Session | null {
  return tabSession(code) ?? savedSession(code);
}

/** Шаг, на котором этот клиент уже отправил «готов» (переживает обновление страницы). */
export function readyStepKey(code: string): string {
  return `mafia.ready.${code}`;
}

export function rememberReady(code: string, step: number): void {
  safeSet(sessionStorage, readyStepKey(code), String(step));
}

export function readyStep(code: string): number {
  return Number(safeGet(sessionStorage, readyStepKey(code)) ?? -1);
}

/** Отметка, что карточка роли этой партии уже показана (чтобы не показывать при каждом обновлении). */
export function rememberSeen(key: string): void {
  safeSet(sessionStorage, `mafia.seen.${key}`, '1');
}

export function wasSeen(key: string): boolean {
  return safeGet(sessionStorage, `mafia.seen.${key}`) === '1';
}
