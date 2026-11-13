/**
 * Обвязка интеграционных тестов: клиент поверх WebSocket, доступ к состоянию комнаты и к часам.
 * Тесты идут внутри workerd, сеть не используется.
 */
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { GameState, PlayerState, RoleId, ViewEvent } from '@mafia/engine';
import {
  PROTOCOL_VERSION,
  type ChatMessage,
  type ClientMessage,
  type CreateRoomResponse,
  type ErrorCode,
  type GameSnapshot,
  type HostMode,
  type RoomSnapshot,
  type Scene,
  type ServerMessage,
  type SettingsPatch,
} from '@mafia/protocol';
import type { Room } from '../src/room';
import type { RoomState } from '../src/state';

const worker = (exports as unknown as { default: { fetch(request: Request): Promise<Response> } }).default;

export const ORIGIN = 'http://mafia.test';

export function http(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init));
}

export function stubOf(code: string): DurableObjectStub<Room> {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

/** Полное состояние комнаты прямо из Durable Object (копия). null — комнаты нет. */
export function roomState(code: string): Promise<RoomState | null> {
  return runInDurableObject(stubOf(code), (instance: Room) =>
    instance.room ? (JSON.parse(JSON.stringify(instance.room)) as RoomState) : null,
  );
}

/** То, что реально лежит в хранилище объекта. */
export function storedRoom(code: string): Promise<RoomState | undefined> {
  return runInDurableObject(stubOf(code), (_instance: Room, state) => state.storage.get<RoomState>('room'));
}

/** Перемотать часы комнаты вперёд и дать сработать будильнику. Возвращает, сработал ли он. */
export async function advanceClock(code: string, ms: number): Promise<boolean> {
  await runInDurableObject(stubOf(code), (instance: Room) => {
    instance.skewMs += ms;
  });
  return runDurableObjectAlarm(stubOf(code));
}

/**
 * Сбросить ограничение частоты сообщений (оно живёт в памяти объекта и считается по настоящим часам).
 * Боты в тестах ходят намного быстрее людей; для них окно в 10 секунд «перематывается».
 */
export async function resetRateLimit(code: string): Promise<void> {
  await runInDurableObject(stubOf(code), (instance: Room) => {
    (instance as unknown as { rate: Map<string, unknown> }).rate.clear();
  });
}

/** Усыпить объект: память сбрасывается, хранилище и соединения остаются. */
export async function hibernate(code: string): Promise<void> {
  await evictDurableObject(stubOf(code));
}

export async function createRoom(
  name = 'Хост',
  password = 'пароль',
  hostMode?: HostMode,
): Promise<CreateRoomResponse> {
  const response = await http('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password, hostMode }),
  });
  if (response.status !== 201) throw new Error(`Комната не создана: ${response.status} ${await response.text()}`);
  return (await response.json()) as CreateRoomResponse;
}

export type Reply = { ok: true; rev: number } | { ok: false; code: ErrorCode; message: string };

interface Waiter {
  test: () => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Тестовый клиент. Запоминает ВСЕ полученные сообщения — и разобранные, и сырые. */
export class Client {
  readonly code: string;
  readonly ws: WebSocket;
  /** Все сообщения сервера в порядке получения. */
  readonly inbox: ServerMessage[] = [];
  /** Те же сообщения в сыром виде (raw[i] соответствует inbox[i]) — для поиска утечек. */
  readonly raw: string[] = [];
  /** Сколько раз сервер ответил на «ping». */
  pongs = 0;
  memberId = '';
  token: string | null = null;
  room: RoomSnapshot | null = null;
  game: GameSnapshot | null = null;
  /** Весь журнал событий, полученный этим клиентом. */
  events: ViewEvent[] = [];
  scenes: Scene[] = [];
  chat: ChatMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  /** Наибольший номер рассылки, который видел клиент. */
  rev = 0;
  private nextId = 1;
  private waiters: Waiter[] = [];

  private constructor(code: string, ws: WebSocket) {
    this.code = code;
    this.ws = ws;
    ws.addEventListener('message', (event) => this.onMessage(event.data as string));
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.wake();
    });
    ws.accept();
  }

  /** Открыть соединение без входа. */
  static async open(code: string, headers: Record<string, string> = {}): Promise<Client> {
    const response = await http(`/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket', ...headers } });
    if (!response.webSocket) throw new Error(`WebSocket не открыт: ${response.status} ${await response.text()}`);
    return new Client(code, response.webSocket);
  }

  /** Войти по имени и паролю. Бросает, если сервер отказал. */
  static async join(code: string, name: string, password = 'пароль', headers: Record<string, string> = {}): Promise<Client> {
    const client = await Client.open(code, headers);
    client.send({ t: 'hello', v: PROTOCOL_VERSION, name, password });
    await client.welcomed();
    return client;
  }

  /** Войти по токену (переподключение). */
  static async resume(code: string, token: string): Promise<Client> {
    const client = await Client.open(code);
    client.send({ t: 'hello', v: PROTOCOL_VERSION, token });
    await client.welcomed();
    client.token = token;
    return client;
  }

  private async welcomed(): Promise<void> {
    await this.until(() => this.memberId !== '' || this.lastError() !== null || this.closed !== null);
    if (this.memberId === '') {
      const error = this.lastError();
      throw new Error(`Вход отклонён: ${error ? `${error.code} ${error.message}` : `закрыто ${this.closed?.code}`}`);
    }
  }

  lastError(): Extract<ServerMessage, { t: 'error' }> | null {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const message = this.inbox[i] as ServerMessage;
      if (message.t === 'error') return message;
    }
    return null;
  }

  byes(): Extract<ServerMessage, { t: 'bye' }>[] {
    return this.inbox.filter((m): m is Extract<ServerMessage, { t: 'bye' }> => m.t === 'bye');
  }

  private onMessage(data: string): void {
    if (data === 'pong') {
      this.pongs += 1;
      this.wake();
      return;
    }
    this.raw.push(data);
    const message = JSON.parse(data) as ServerMessage;
    this.inbox.push(message);
    switch (message.t) {
      case 'welcome':
        this.memberId = message.memberId;
        if (message.token) this.token = message.token;
        this.room = message.room;
        this.game = message.game;
        this.events = [...message.history];
        this.scenes = [...message.scenes];
        this.chat = [...message.chat];
        this.rev = Math.max(this.rev, message.room.rev);
        break;
      case 'room':
        this.room = message.room;
        if (message.room.stage === 'lobby') this.game = null;
        this.rev = Math.max(this.rev, message.room.rev);
        break;
      case 'game':
        this.game = message.game;
        this.events.push(...message.events);
        this.scenes.push(...message.scenes);
        this.rev = Math.max(this.rev, message.game.rev);
        break;
      case 'chat':
        this.chat.push(message.message);
        break;
      default:
        break;
    }
    this.wake();
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) {
      if (!waiter.test()) continue;
      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }

  /** Дождаться, пока условие станет истинным. */
  until(test: () => boolean, what = 'условие', timeoutMs = 5000): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        test,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`Клиент ${this.memberId || '?'}: не дождался — ${what}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  untilRev(rev: number): Promise<void> {
    return this.until(() => this.rev >= rev || this.closed !== null, `рассылка №${rev}`);
  }

  untilClosed(): Promise<void> {
    return this.until(() => this.closed !== null, 'закрытие соединения');
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  /** Отправить сообщение и дождаться ответа на него: подтверждения или ошибки. */
  async request(message: ClientMessage): Promise<Reply> {
    const id = this.nextId++;
    const mark = this.inbox.length;
    this.send({ ...message, id });
    let reply: Reply | null = null;
    await this.until(() => {
      for (let i = mark; i < this.inbox.length; i++) {
        const m = this.inbox[i] as ServerMessage;
        if (m.t === 'ack' && m.re === id) reply = { ok: true, rev: m.rev };
        if (m.t === 'error' && m.re === id) reply = { ok: false, code: m.code, message: m.message };
      }
      return reply !== null || this.closed !== null;
    }, `ответ на ${message.t}`);
    return reply ?? { ok: false, code: 'INTERNAL', message: 'соединение закрыто' };
  }

  /** То же, но ошибка сервера превращается в исключение. */
  async ok(message: ClientMessage): Promise<number> {
    const reply = await this.request(message);
    if (!reply.ok) throw new Error(`${message.t}: ${reply.code} ${reply.message}`);
    return reply.rev;
  }

  /** Закрыть соединение и дождаться, пока сервер это обработает. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.ws.close(1000, 'bye');
    await this.untilClosed();
  }
}

/** Стол: комната и её клиенты. Умеет дожидаться, пока рассылка дойдёт до всех. */
export class Table {
  readonly code: string;
  clients: Client[] = [];

  constructor(code: string) {
    this.code = code;
  }

  /** Создать комнату и посадить за стол хоста и ещё `others` игроков. */
  static async create(others: number, options: { hostMode?: HostMode; settings?: SettingsPatch } = {}): Promise<Table> {
    const created = await createRoom('Хост', 'пароль', options.hostMode);
    const table = new Table(created.code);
    table.clients.push(await Client.resume(created.code, created.token));
    for (let i = 0; i < others; i++) table.clients.push(await Client.join(created.code, `Игрок ${i + 1}`));
    if (options.settings) await table.host.ok({ t: 'settings', patch: options.settings });
    await table.settle();
    return table;
  }

  get host(): Client {
    return this.clients[0] as Client;
  }

  get open(): Client[] {
    return this.clients.filter((c) => !c.closed);
  }

  byId(memberId: string): Client {
    const client = this.clients.find((c) => c.memberId === memberId && !c.closed);
    if (!client) throw new Error(`За столом нет клиента ${memberId}`);
    return client;
  }

  /** Дождаться, пока все открытые клиенты получат последнюю рассылку. */
  async settle(): Promise<RoomState> {
    const state = await roomState(this.code);
    if (!state) throw new Error('Комнаты нет');
    await Promise.all(this.open.map((c) => c.untilRev(state.rev)));
    return state;
  }

  async state(): Promise<RoomState> {
    const state = await roomState(this.code);
    if (!state) throw new Error('Комнаты нет');
    return state;
  }

  async game(): Promise<GameState> {
    const state = await this.state();
    if (!state.game) throw new Error('Партия не идёт');
    return state.game;
  }

  /** Начать партию. */
  async start(): Promise<GameState> {
    await this.host.ok({ t: 'start' });
    await this.settle();
    return this.game();
  }

  /** Игрок с данной ролью (n-й по порядку мест) и его клиент. */
  async seat(role: RoleId, n = 0): Promise<{ player: PlayerState; client: Client }> {
    const game = await this.game();
    const player = game.players.filter((p) => p.role === role)[n];
    if (!player) throw new Error(`В партии нет роли ${role}`);
    return { player, client: this.byId(player.id) };
  }

  /** Перемотать часы и дать сработать будильнику. */
  async tick(ms: number): Promise<boolean> {
    const ran = await advanceClock(this.code, ms);
    if (await roomState(this.code)) await this.settle();
    return ran;
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.open.map((c) => c.close()));
  }
}
