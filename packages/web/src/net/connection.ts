/**
 * WebSocket комнаты: вход (`hello`), запросы с подтверждением, `ping`, переподключение.
 *
 * - Первое сообщение — `hello` с токеном, а при первом входе — с именем и паролем. После `welcome`
 *   соединение входит дальше только по токену.
 * - `ping` раз в 25 секунд: сервер отвечает `pong`, не просыпаясь, — соединение держится бесплатно.
 * - Обрыв — переподключение с растущей задержкой (до 10 секунд). Коды 4000–4003 означают, что
 *   повторять с теми же данными бессмысленно: соединение закрывается окончательно.
 */
import { CLOSE_CODES, ERROR_MESSAGES, PROTOCOL_VERSION } from '@mafia/protocol';
import type { ClientMessage, ErrorCode, ServerMessage } from '@mafia/protocol';
import { roomWsUrl } from './config';

export type Auth = { token: string } | { name: string; password: string };

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'closed';

export interface CloseInfo {
  code: ErrorCode | 'NETWORK';
  message: string;
  /** Код закрытия WebSocket. */
  wsCode: number;
}

export type Reply = { ok: true } | { ok: false; code: ErrorCode | 'NETWORK'; message: string };

export interface ConnectionHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus, close: CloseInfo | null): void;
}

/** Фабрика сокетов — подменяется в тестах. */
export type SocketFactory = (url: string) => WebSocket;

const PING_MS = 25_000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 7000, 10_000];
const REQUEST_TIMEOUT_MS = 15_000;

/** Распределяет любые запросы, чтобы распознавать дубли `id`. */
let requestSeq = 1;

export class RoomConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, { resolve: (reply: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  private lastError: { code: ErrorCode; message: string } | null = null;
  private stopped = false;
  private welcomed = false;
  status: ConnectionStatus = 'connecting';

  constructor(
    readonly code: string,
    private auth: Auth,
    private readonly handlers: ConnectionHandlers,
    private readonly factory: SocketFactory = (url) => new WebSocket(url),
  ) {}

  /** После `welcome` повторные входы идут по токену. */
  useToken(token: string): void {
    this.auth = { token };
  }

  start(): void {
    this.stopped = false;
    this.open();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onVisible);
  }

  /** Закрыть насовсем (уход со страницы комнаты). */
  stop(): void {
    this.stopped = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onVisible);
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close(1000);
    this.failPending('NETWORK', 'Соединение закрыто');
  }

  /** Немедленно переподключиться (кнопка «Повторить», возврат на вкладку). */
  reconnectNow(): void {
    if (this.stopped) this.stopped = false;
    if (this.ws && this.ws.readyState <= 1) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open();
  }

  /** Отправить сообщение и дождаться `ack` или `error`. */
  request(message: ClientMessage): Promise<Reply> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || !this.welcomed) {
      return Promise.resolve({ ok: false, code: 'NETWORK', message: 'Нет связи с сервером' });
    }
    const id = requestSeq++;
    return new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: 'NETWORK', message: 'Сервер не ответил' });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      ws.send(JSON.stringify({ ...message, id }));
    });
  }

  private onVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (this.stopped || this.status === 'closed') return;
    if (!this.ws || this.ws.readyState > 1) this.reconnectNow();
  };

  private setStatus(status: ConnectionStatus, close: CloseInfo | null = null): void {
    this.status = status;
    this.handlers.onStatus(status, close);
  }

  private open(): void {
    this.clearTimers();
    this.welcomed = false;
    this.lastError = null;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      ws = this.factory(roomWsUrl(this.code));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const hello: ClientMessage =
        'token' in this.auth
          ? { t: 'hello', v: PROTOCOL_VERSION, token: this.auth.token }
          : { t: 'hello', v: PROTOCOL_VERSION, name: this.auth.name, password: this.auth.password };
      ws.send(JSON.stringify(hello));
      this.pingTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send('ping');
      }, PING_MS);
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws || typeof event.data !== 'string' || event.data === 'pong') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.onServerMessage(message);
    };
    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.failPending('NETWORK', 'Соединение потеряно');
      if (this.stopped) return;
      const final =
        event.code === CLOSE_CODES.REJECTED ||
        event.code === CLOSE_CODES.REMOVED ||
        event.code === CLOSE_CODES.REPLACED ||
        event.code === CLOSE_CODES.ROOM_CLOSED;
      if (final) {
        const code: ErrorCode =
          this.lastError?.code ??
          (event.code === CLOSE_CODES.REPLACED ? 'REPLACED' : event.code === CLOSE_CODES.ROOM_CLOSED ? 'ROOM_CLOSED' : 'KICKED');
        this.setStatus('closed', { code, message: this.lastError?.message ?? ERROR_MESSAGES[code], wsCode: event.code });
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // за ошибкой всегда следует close — там и разберёмся
    };
  }

  private onServerMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.welcomed = true;
        this.attempt = 0;
        if (message.token) this.useToken(message.token);
        this.setStatus('online');
        break;
      case 'ack': {
        const entry = this.pending.get(message.re);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(message.re);
          entry.resolve({ ok: true });
        }
        return;
      }
      case 'error': {
        if (message.re !== null) {
          const entry = this.pending.get(message.re);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(message.re);
            entry.resolve({ ok: false, code: message.code, message: message.message });
            return;
          }
        }
        // ошибка без номера — отказ во входе (за ним последует закрытие)
        this.lastError = { code: message.code, message: message.message };
        break;
      }
      case 'bye':
        this.lastError = { code: message.code, message: message.message };
        break;
      default:
        break;
    }
    this.handlers.onMessage(message);
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] as number;
    this.attempt += 1;
    this.setStatus('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private failPending(code: 'NETWORK', message: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, code, message });
    }
    this.pending.clear();
  }
}
