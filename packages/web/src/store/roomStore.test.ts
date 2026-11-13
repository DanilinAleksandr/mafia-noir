/**
 * Хранилище и соединение: вход, токен, журнал без повторов, возврат в лобби, переподключение,
 * окончательное закрытие. Сокет — подделка.
 */
import { PROTOCOL_VERSION } from '@mafia/protocol';
import type { ServerMessage } from '@mafia/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedSession, tabSession } from '../net/session';
import { eventsFor, newGame, nightKill, room, snapshot } from '../test/fixtures';
import { RoomStore } from './roomStore';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  json(): Record<string, unknown>[] {
    return this.sent.filter((s) => s !== 'ping').map((s) => JSON.parse(s));
  }
}

function setup() {
  FakeSocket.all = [];
  const store = new RoomStore('K7MPQ', (url) => new FakeSocket(url) as unknown as WebSocket);
  return store;
}

const ROLES = ['mafia', 'commissioner', 'doctor', 'civilian', 'civilian'] as const;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RoomStore', () => {
  it('первый вход: hello с именем и паролем, токен сохраняется, дальше вход по токену', () => {
    const store = setup();
    store.connect({ name: 'Аня', password: '1234' });
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe('ws://localhost:3000/api/rooms/K7MPQ/ws');
    ws.open();
    expect(ws.json()[0]).toEqual({ t: 'hello', v: PROTOCOL_VERSION, name: 'Аня', password: '1234' });
    ws.receive({ t: 'welcome', v: PROTOCOL_VERSION, memberId: 'm1', token: 'tok', room: room(1), game: null, history: [], scenes: [], chat: [] });
    expect(store.getState()).toMatchObject({ status: 'online', memberId: 'm1' });
    expect(tabSession('K7MPQ')).toMatchObject({ token: 'tok', name: 'Аня', memberId: 'm1' });
    expect(savedSession('K7MPQ')?.token).toBe('tok');

    // обрыв — переподключение по токену
    ws.drop(1006);
    expect(store.getState().status).toBe('reconnecting');
    vi.advanceTimersByTime(600);
    const again = FakeSocket.all[1]!;
    again.open();
    expect(again.json()[0]).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: 'tok' });
    store.disconnect();
  });

  it('отказ во входе (4000) — окончательно, с текстом ошибки; без повторных попыток', () => {
    const store = setup();
    store.connect({ name: 'Аня', password: 'нет' });
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.receive({ t: 'error', code: 'WRONG_PASSWORD', message: 'Неверный пароль. Осталось попыток: 4', re: null });
    ws.drop(4000);
    expect(store.getState()).toMatchObject({ status: 'closed', close: { code: 'WRONG_PASSWORD', message: 'Неверный пароль. Осталось попыток: 4' } });
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('исключение хостом забывает сессию', () => {
    const store = setup();
    store.connect({ token: 'tok' });
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.receive({ t: 'welcome', v: PROTOCOL_VERSION, memberId: 'm2', token: 'tok2', room: room(2), game: null, history: [], scenes: [], chat: [] });
    ws.receive({ t: 'bye', code: 'KICKED', message: 'Хост исключил вас из комнаты' });
    ws.drop(4001);
    expect(store.getState().close?.code).toBe('KICKED');
    expect(savedSession('K7MPQ')).toBeNull();
  });

  it('журнал собирается из истории и новых событий без повторов; лобби всё сбрасывает', () => {
    const store = setup();
    store.connect({ token: 'tok' });
    const ws = FakeSocket.all[0]!;
    ws.open();
    const start = newGame([...ROLES]);
    const startEvents = eventsFor(start, 'm4');
    ws.receive({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      memberId: 'm4',
      token: null,
      room: room(5, 'm1', { stage: 'game' }),
      game: snapshot(start, 'm4', 'night'),
      history: startEvents,
      scenes: [],
      chat: [],
    });
    const morning = nightKill(start, 'm5');
    const all = eventsFor(morning, 'm4');
    const fresh = all.filter((e) => !startEvents.some((s) => s.id === e.id));
    // одно и то же сообщение дважды — события не дублируются
    const message: ServerMessage = { t: 'game', game: snapshot(morning, 'm4', 'morning', { step: 2 }), events: fresh, scenes: [] };
    ws.receive(message);
    ws.receive(message);
    expect(store.getState().events.map((e) => e.id)).toEqual(all.map((e) => e.id));
    // утром показывается отчёт о ночи (после раздачи роли)
    expect(store.presenter.current?.kind).toBe('roleReveal');

    ws.receive({ t: 'room', room: room(5, 'm1', { stage: 'lobby' }) });
    expect(store.getState()).toMatchObject({ game: null, events: [], chat: [] });
    expect(store.presenter.current).toBeNull();
    store.disconnect();
  });

  it('запрос получает ответ по номеру: ack — успех, error — текст ошибки', async () => {
    const store = setup();
    store.connect({ token: 'tok' });
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.receive({ t: 'welcome', v: PROTOCOL_VERSION, memberId: 'm1', token: null, room: room(4), game: null, history: [], scenes: [], chat: [] });
    const pending = store.start();
    const sent = ws.json().at(-1) as { t: string; id: number };
    expect(sent.t).toBe('start');
    ws.receive({ t: 'error', code: 'CANNOT_START', message: 'Нужно минимум 4 игрока', re: sent.id });
    await expect(pending).resolves.toEqual({ ok: false, code: 'CANNOT_START', message: 'Нужно минимум 4 игрока' });
    expect(store.getState().toast?.text).toBe('Нужно минимум 4 игрока');
    store.disconnect();
  });
});
