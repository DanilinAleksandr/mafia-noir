/**
 * Коды ошибок протокола и их тексты по-русски.
 * Клиент может показывать `message` как есть, а ветвиться — по `code`.
 */
export const ERROR_MESSAGES = {
  // разбор сообщений
  BAD_MESSAGE: 'Сообщение не разобрано',
  TOO_LARGE: 'Сообщение слишком большое',
  RATE_LIMITED: 'Слишком много сообщений подряд. Подождите пару секунд',
  PROTOCOL_VERSION: 'Версия клиента не подходит: обновите страницу',
  // вход
  NOT_AUTHENTICATED: 'Сначала нужно войти в комнату',
  ALREADY_AUTHENTICATED: 'Вы уже вошли в комнату',
  ROOM_NOT_FOUND: 'Комната не найдена',
  ROOM_FULL: 'В комнате нет свободных мест',
  ROOM_STARTED: 'Игра уже идёт: новые игроки войти не могут',
  ROOM_BUSY: 'Слишком много подключений к комнате',
  TOO_MANY_ROOMS: 'Слишком много новых комнат. Попробуйте позже',
  BAD_ORIGIN: 'Подключение возможно только со страницы игры',
  WRONG_PASSWORD: 'Неверный пароль',
  TOO_MANY_ATTEMPTS: 'Слишком много неверных попыток. Попробуйте позже',
  BAD_TOKEN: 'Сессия не найдена: войдите заново по паролю',
  BAD_NAME: 'Имя должно быть от 1 до 20 символов',
  NAME_TAKEN: 'Это имя уже занято в комнате',
  BAD_PASSWORD: 'Пароль должен быть от 1 до 64 символов',
  // права и состояние
  NOT_HOST: 'Это может сделать только хост',
  WRONG_STAGE: 'Сейчас это действие недоступно',
  STALE: 'Ситуация уже изменилась',
  UNKNOWN_MEMBER: 'Такого участника нет в комнате',
  BAD_SETTINGS: 'Некорректные настройки',
  CANNOT_START: 'Игру нельзя начать',
  NOT_PLAYING: 'Вы не участвуете в этой партии',
  CHAT_FORBIDDEN: 'Чат мафии доступен ночью и только живым мафиози',
  // закрытие соединения
  KICKED: 'Хост исключил вас из комнаты',
  LEFT: 'Вы вышли из комнаты',
  REPLACED: 'Вы вошли с другого устройства',
  ROOM_CLOSED: 'Комната закрыта из-за простоя',
  // игра (ошибки движка)
  GAME_WRONG_PHASE: 'Сейчас другая фаза игры',
  GAME_DECISION_PENDING: 'Игра ждёт решения игрока',
  GAME_NO_DECISION: 'Сейчас от вас не ждут решения',
  GAME_UNKNOWN_PLAYER: 'Игрок не найден',
  GAME_PLAYER_DEAD: 'Мёртвые не действуют',
  GAME_INVALID_ACTION: 'Это действие вам недоступно',
  GAME_INVALID_TARGET: 'Эту цель выбрать нельзя',
  GAME_INVALID_CONFIG: 'Некорректные настройки игры',
  GAME_INVALID_COMPOSITION: 'Состав собрать не удалось',
  // прочее
  INTERNAL: 'Внутренняя ошибка сервера',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_MESSAGES;
}

/** Текст ошибки: уточнённый, если он передан, иначе стандартный для кода. */
export function errorText(code: ErrorCode, detail?: string): string {
  return detail && detail.length > 0 ? detail : ERROR_MESSAGES[code];
}

/** Код ошибки протокола для кода ошибки движка (`EngineError.code`). */
export function engineErrorCode(engineCode: string): ErrorCode {
  const code = `GAME_${engineCode}`;
  return isErrorCode(code) ? code : 'INTERNAL';
}

/** Коды закрытия WebSocket, которые использует сервер. */
export const CLOSE_CODES = {
  /** Обычное закрытие. */
  NORMAL: 1000,
  /** Нарушение протокола или отказ во входе. Клиенту не нужно переподключаться с теми же данными. */
  REJECTED: 4000,
  /** Исключён хостом или вышел сам. */
  REMOVED: 4001,
  /** Соединение заменено новым с того же аккаунта. */
  REPLACED: 4002,
  /** Комната удалена. */
  ROOM_CLOSED: 4003,
} as const;
