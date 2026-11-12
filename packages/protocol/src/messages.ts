/**
 * Типы сообщений между клиентом и сервером.
 *
 * Транспорт: WebSocket, каждое сообщение — JSON-объект с полем `t` (тип).
 * Первое сообщение клиента — `hello`. Отдельно от JSON ходят строки `ping` → `pong`
 * (сервер отвечает на них, не просыпаясь).
 */
import type {
  CompositionConfig,
  Decision,
  EventType,
  NightAction,
  PlayerId,
  PlayerView,
  Quota,
  QuotaKey,
  RoleId,
  RoleSetting,
  Rules,
  ViewEvent,
} from '@mafia/engine';
import type { ErrorCode } from './errors';

/** Версия протокола. Меняется при несовместимых изменениях сообщений. */
export const PROTOCOL_VERSION = 1;

/** Участник комнаты. В игре его id совпадает с id игрока в движке. */
export type MemberId = PlayerId;

// ───────────────────────────── настройки комнаты ─────────────────────────────

/** Хост играет сам или только ведёт игру и наблюдает. */
export type HostMode = 'player' | 'narrator';

/**
 * Режим показа событий:
 * - stealth — «Скрытный»: каждый получает только то, что вправе видеть;
 * - open — «Открытый состав»: дополнительно всем виден список ролей в партии, без владельцев;
 * - cinema — «Кино»: открытый состав плюс обезличенные «сцены» ночи для всех
 *   (что произошло и какая роль действовала, но без игроков и результатов).
 */
export type DisplayMode = 'stealth' | 'open' | 'cinema';

/** Таймеры фаз в секундах; null — таймер выключен. */
export interface TimerSettings {
  night: number | null;
  day: number | null;
  decision: number | null;
}

export interface RoomSettings {
  hostMode: HostMode;
  display: DisplayMode;
  timers: TimerSettings;
  rules: Rules;
  composition: CompositionConfig;
}

/** Частичное изменение настроек. Вложенные `roles` и `quotas` заменяются целиком. */
export interface SettingsPatch {
  hostMode?: HostMode;
  display?: DisplayMode;
  timers?: Partial<TimerSettings>;
  rules?: Partial<Rules>;
  composition?: {
    roles?: Partial<Record<RoleId, RoleSetting>>;
    quotas?: Partial<Record<QuotaKey, Quota>>;
    preset?: RoleId[] | null;
    minCiviliansShare?: number | null;
  };
}

// ───────────────────────────── снимки состояния ─────────────────────────────

export type RoomStage = 'lobby' | 'game' | 'finished';

export interface MemberInfo {
  id: MemberId;
  name: string;
  online: boolean;
  isHost: boolean;
  /** Участвует в партии (или будет участвовать, если игра ещё не началась). */
  playing: boolean;
}

/** Состояние комнаты: одинаковое для всех участников. */
export interface RoomSnapshot {
  /** Номер рассылки: растёт с каждой рассылкой `room` или `game`. */
  rev: number;
  code: string;
  stage: RoomStage;
  hostId: MemberId;
  members: MemberInfo[];
  settings: RoomSettings;
  /**
   * Хост задал состав вручную, но получателю он не показан: в режиме «Скрытный» ручной состав
   * (`settings.composition.preset`) видит только хост, остальным приходит null.
   */
  presetHidden: boolean;
  /** Почему сейчас нельзя начать игру (пусто — можно). */
  startIssues: string[];
  /** Предупреждения о составе (игру начать можно). */
  startWarnings: string[];
}

/**
 * Стадия партии с точки зрения сервера:
 * - night — принимаются ночные ходы;
 * - decision — игра ждёт решения одного игрока (чьего — видит только он);
 * - morning — ночь разрешена, клиенты показывают итоги и шлют `ready`;
 * - day — принимаются голоса;
 * - ended — партия окончена.
 */
export type GameStage = 'night' | 'decision' | 'morning' | 'day' | 'ended';

/** Представление игрока без журнала: журнал приходит отдельно, порциями. */
export type ClientView = Omit<PlayerView, 'events'>;

export interface RoleCount {
  role: RoleId;
  count: number;
}

export interface GameSnapshot {
  /** Номер рассылки: общий счётчик с `RoomSnapshot.rev`. */
  rev: number;
  /** Номер шага: растёт при каждой смене стадии. Его передают в `ready` и `advance`. */
  step: number;
  stage: GameStage;
  /** Когда стадия закончится сама (мс с эпохи); null — таймера нет. */
  deadline: number | null;
  /** Время сервера на момент отправки (мс с эпохи) — чтобы клиент поправил свои часы. */
  serverTime: number;
  display: DisplayMode;
  /** Список ролей в партии без владельцев — в режимах «Открытый состав» и «Кино». */
  composition: RoleCount[] | null;
  /**
   * Прогресс стадии, без имён: сколько живых сделали ночной ход, сколько проголосовали,
   * сколько клиентов готовы начать день.
   */
  progress: { done: number; total: number } | null;
  view: ClientView;
}

/**
 * Обезличенная сцена ночи (режим «Кино»): что произошло и какая роль действовала.
 * Ни игроков, ни результатов в сцене нет.
 */
export interface Scene {
  /** Номер события движка, по которому построена сцена. */
  id: number;
  round: number;
  type: EventType;
  /** Роль действовавшего; null — если действовала команда (мафия). */
  role: RoleId | null;
}

export interface ChatMessage {
  id: number;
  from: MemberId;
  name: string;
  text: string;
  /** Время сервера (мс с эпохи). */
  at: number;
  round: number;
}

// ───────────────────────────── клиент → сервер ─────────────────────────────

/** Необязательный номер запроса: сервер вернёт его в `ack` или `error` (поле `re`). */
interface Req {
  id?: number;
}

export type ClientMessage = Req &
  (
    | {
        t: 'hello';
        /** Версия протокола клиента. */
        v: number;
        /** Токен переподключения (если уже входили)… */
        token?: string;
        /** …или имя и пароль комнаты (первый вход). */
        name?: string;
        password?: string;
      }
    // лобби
    | { t: 'settings'; patch: SettingsPatch }
    | { t: 'kick'; memberId: MemberId }
    | { t: 'transferHost'; memberId: MemberId }
    | { t: 'leave' }
    | { t: 'start' }
    // игра
    | { t: 'night'; action: NightAction }
    | { t: 'vote'; target: PlayerId | null }
    | { t: 'decision'; decision: Decision }
    | { t: 'ready'; step: number }
    | { t: 'advance'; step: number }
    | { t: 'toLobby' }
    | { t: 'chat'; text: string }
  );

export type ClientMessageType = ClientMessage['t'];

// ───────────────────────────── сервер → клиент ─────────────────────────────

export type ServerMessage =
  | {
      t: 'welcome';
      v: number;
      memberId: MemberId;
      /** Токен переподключения. Приходит только при первом входе — его нужно сохранить. */
      token: string | null;
      room: RoomSnapshot;
      game: GameSnapshot | null;
      /** Весь журнал событий в видимости этого участника. */
      history: ViewEvent[];
      scenes: Scene[];
      /** Чат мафии — только живым чёрным. */
      chat: ChatMessage[];
    }
  /** Изменилась комната: состав, онлайн, хост, настройки, стадия. */
  | { t: 'room'; room: RoomSnapshot }
  /** Изменилась игра. `events` — новые события в видимости получателя. */
  | { t: 'game'; game: GameSnapshot; events: ViewEvent[]; scenes: Scene[] }
  | { t: 'chat'; message: ChatMessage }
  /** Запрос с номером `re` выполнен. `rev` — номер последней рассылки на этот момент. */
  | { t: 'ack'; re: number; rev: number }
  | { t: 'error'; code: ErrorCode; message: string; re: number | null }
  /** Сервер закрывает соединение; переподключаться с теми же данными не нужно. */
  | { t: 'bye'; code: ErrorCode; message: string };

export type ServerMessageType = ServerMessage['t'];

// ───────────────────────────── HTTP ─────────────────────────────

/** POST /api/rooms */
export interface CreateRoomRequest {
  name: string;
  password: string;
  hostMode?: HostMode;
}

export interface CreateRoomResponse {
  code: string;
  memberId: MemberId;
  /** Токен хоста: с ним открывается WebSocket (`hello` с `token`). */
  token: string;
}

/** GET /api/rooms/:code */
export interface RoomInfoResponse {
  code: string;
  stage: RoomStage;
  members: number;
  /** Можно ли сейчас войти новому игроку. */
  joinable: boolean;
}

export interface ErrorResponse {
  error: { code: ErrorCode; message: string };
}
