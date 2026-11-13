/**
 * Хранилище комнаты: последнее, что прислал сервер, и намерения игрока.
 *
 * Клиент ничего не вычисляет и не хранит сверх присланного: снимок комнаты, снимок партии,
 * журнал (история из `welcome` плюс события из каждого `game`), личные сцены и чат мафии.
 * Визуальные реакции на события идут через Presenter.
 */
import type { Decision, NightAction, PlayerId, ViewEvent } from '@mafia/engine';
import type {
  ChatMessage,
  ClientMessage,
  ErrorCode,
  GameSnapshot,
  RoomSnapshot,
  Scene,
  ServerMessage,
  SettingsPatch,
} from '@mafia/protocol';
import { type Auth, type CloseInfo, type ConnectionStatus, type Reply, RoomConnection, type SocketFactory } from '../net/connection';
import { forgetSession, readyStep, rememberReady, rememberSeen, storeSession, wasSeen } from '../net/session';
import { type Presentation, Presenter } from '../presenter/presenter';
import { vibrate } from '../settings/haptics';

/** Личная заметка игрока (блокнот у тех, у кого нет чата мафии). Хранится только на устройстве. */
export interface Note {
  id: number;
  text: string;
  at: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

export interface RoomViewState {
  code: string;
  status: ConnectionStatus;
  close: CloseInfo | null;
  memberId: string | null;
  room: RoomSnapshot | null;
  game: GameSnapshot | null;
  events: ViewEvent[];
  scenes: Scene[];
  chat: ChatMessage[];
  /** Сдвиг часов: серверное время минус местное (мс). */
  clockOffset: number;
  toast: Toast | null;
  presentation: Presentation | null;
  /** Сколько сообщений чата не прочитано (на экран не выводится: значок выдал бы мафию). */
  unreadChat: number;
  notes: Note[];
}

/** Коды, при которых сессию нужно забыть: войти с ней снова не получится. */
const SESSION_DEAD: ReadonlySet<ErrorCode | 'NETWORK'> = new Set(['BAD_TOKEN', 'KICKED', 'LEFT', 'ROOM_CLOSED', 'ROOM_NOT_FOUND']);

let toastSeq = 1;

export class RoomStore {
  private state: RoomViewState;
  private listeners = new Set<() => void>();
  private connection: RoomConnection | null = null;
  readonly presenter: Presenter;
  private chatOpen = false;
  /** Имя для сохранения сессии при первом входе. */
  private joinName: string | null = null;

  constructor(
    code: string,
    private readonly factory?: SocketFactory,
  ) {
    this.state = {
      code,
      status: 'connecting',
      close: null,
      memberId: null,
      room: null,
      game: null,
      events: [],
      scenes: [],
      chat: [],
      clockOffset: 0,
      toast: null,
      presentation: null,
      unreadChat: 0,
      notes: loadNotes(code),
    };
    this.presenter = new Presenter((done) => this.onPresentationDone(done));
    this.presenter.subscribe(() => this.set({ presentation: this.presenter.current }));
  }

  // ───────────────────────────── подписка (useSyncExternalStore) ─────────────────────────────

  getState = (): RoomViewState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<RoomViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ───────────────────────────── соединение ─────────────────────────────

  connect(auth: Auth): void {
    this.connection?.stop();
    this.joinName = 'name' in auth ? auth.name : null;
    this.set({ status: 'connecting', close: null });
    this.connection = new RoomConnection(
      this.state.code,
      auth,
      {
        onMessage: (message) => this.onMessage(message),
        onStatus: (status, close) => this.onStatus(status, close),
      },
      this.factory,
    );
    this.connection.start();
  }

  disconnect(): void {
    this.connection?.stop();
    this.connection = null;
  }

  retry(): void {
    this.connection?.reconnectNow();
  }

  /** Комнаты больше нет (выяснилось по HTTP, пока сокет не открывался): прекратить попытки. */
  markGone(): void {
    this.disconnect();
    forgetSession(this.state.code);
    this.set({ status: 'closed', close: { code: 'ROOM_NOT_FOUND', message: 'Комната не найдена или уже закрыта', wsCode: 0 } });
  }

  private onStatus(status: ConnectionStatus, close: CloseInfo | null): void {
    if (status === 'closed' && close && SESSION_DEAD.has(close.code)) forgetSession(this.state.code);
    this.set({ status, close });
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome': {
        const me = message.room.members.find((m) => m.id === message.memberId);
        if (message.token) {
          storeSession({
            code: this.state.code,
            memberId: message.memberId,
            name: me?.name ?? this.joinName ?? '',
            token: message.token,
          });
        }
        this.presenter.reset();
        const game = message.room.stage === 'lobby' ? null : message.game;
        this.set({
          memberId: message.memberId,
          room: message.room,
          game,
          events: game ? sortEvents(message.history) : [],
          scenes: game ? message.scenes : [],
          chat: game ? message.chat : [],
          clockOffset: game ? game.serverTime - Date.now() : this.state.clockOffset,
          unreadChat: 0,
        });
        if (game) this.feedPresenter(game, [], true);
        return;
      }
      case 'room': {
        if (message.room.stage === 'lobby' && this.state.room?.stage !== 'lobby') {
          // партия закончилась или прервана: всё, что относилось к ней, забываем
          this.presenter.reset();
          this.set({ room: message.room, game: null, events: [], scenes: [], chat: [], unreadChat: 0 });
          this.clearNotes();
          return;
        }
        this.set({ room: message.room });
        return;
      }
      case 'game': {
        if (this.state.room?.stage === 'lobby' && !message.events.some((e) => e.type === 'gameStarted')) {
          // запоздавший снимок прежней партии
          if (!this.state.game) return;
        }
        const startedNew = message.events.some((e) => e.type === 'gameStarted');
        const base = startedNew ? [] : this.state.events;
        if (startedNew) {
          this.presenter.reset();
          this.clearNotes();
        }
        const known = new Set(base.map((e) => e.id));
        const fresh = message.events.filter((e) => !known.has(e.id));
        const scenes = startedNew ? message.scenes : mergeScenes(this.state.scenes, message.scenes);
        this.set({
          game: message.game,
          events: fresh.length > 0 ? sortEvents([...base, ...fresh]) : base,
          scenes,
          chat: startedNew ? [] : this.state.chat,
          clockOffset: message.game.serverTime - Date.now(),
        });
        this.feedPresenter(message.game, fresh, false);
        this.autoReadyNarrator(message.game);
        return;
      }
      case 'chat': {
        if (this.state.chat.some((m) => m.id === message.message.id)) return;
        // о новом сообщении команды — только вибрацией: значок на кнопке увидел бы сосед
        if (!this.chatOpen && message.message.from !== this.state.memberId) vibrate('notify');
        this.set({
          chat: [...this.state.chat, message.message],
          unreadChat: this.chatOpen || message.message.from === this.state.memberId ? 0 : this.state.unreadChat + 1,
        });
        return;
      }
      case 'error':
        if (message.re === null && this.state.status === 'online') this.toast(message.message, 'error');
        return;
      default:
        return;
    }
  }

  private isNarrator(): boolean {
    const game = this.state.game;
    return Boolean(game && !game.view.you && game.view.backstage);
  }

  private feedPresenter(game: GameSnapshot, fresh: ViewEvent[], initial: boolean): void {
    const code = this.state.code;
    this.presenter.update({
      game,
      events: this.state.events,
      scenes: this.state.scenes,
      fresh,
      initial,
      readyStep: readyStep(code),
      narrator: this.isNarrator(),
      roleSeen: wasSeen(this.roleKey()),
    });
    if (initial) this.autoReadyNarrator(game);
  }

  /** Ведущему отчёты не показываются: «готов» от него уходит сразу. */
  private autoReadyNarrator(game: GameSnapshot): void {
    if (!this.isNarrator()) return;
    if ((game.stage === 'morning' || game.stage === 'evening') && readyStep(this.state.code) !== game.step) {
      void this.ready(game.step);
    }
  }

  /** Ключ «роль этой партии показана»: комната, участник, роль и порядок мест. */
  private roleKey(): string {
    const view = this.state.game?.view;
    return [this.state.code, this.state.memberId, view?.you?.role ?? '', (view?.players ?? []).map((p) => p.id).join(',')].join('.');
  }

  private onPresentationDone(done: Presentation): void {
    if (done.kind === 'roleReveal') rememberSeen(this.roleKey());
    if ((done.kind === 'nightReport' || done.kind === 'verdict') && done.step !== null) {
      const game = this.state.game;
      if (game && game.step === done.step && (game.stage === 'morning' || game.stage === 'evening')) {
        void this.ready(done.step);
      }
    }
  }

  // ───────────────────────────── намерения игрока ─────────────────────────────

  private async send(message: ClientMessage, options: { quiet?: boolean } = {}): Promise<Reply> {
    if (!this.connection) return { ok: false, code: 'NETWORK', message: 'Нет связи с сервером' };
    const reply = await this.connection.request(message);
    if (!reply.ok && !options.quiet && reply.code !== 'STALE') this.toast(reply.message, 'error');
    return reply;
  }

  settings(patch: SettingsPatch): Promise<Reply> {
    return this.send({ t: 'settings', patch });
  }
  start(): Promise<Reply> {
    return this.send({ t: 'start' });
  }
  kick(memberId: string): Promise<Reply> {
    return this.send({ t: 'kick', memberId });
  }
  transferHost(memberId: string): Promise<Reply> {
    return this.send({ t: 'transferHost', memberId });
  }
  async leave(): Promise<Reply> {
    const reply = await this.send({ t: 'leave' });
    if (reply.ok) forgetSession(this.state.code);
    return reply;
  }
  toLobby(): Promise<Reply> {
    return this.send({ t: 'toLobby' });
  }
  night(action: NightAction): Promise<Reply> {
    return this.send({ t: 'night', action });
  }
  vote(target: PlayerId | null): Promise<Reply> {
    return this.send({ t: 'vote', target });
  }
  decision(decision: Decision): Promise<Reply> {
    return this.send({ t: 'decision', decision });
  }
  async ready(step: number): Promise<Reply> {
    rememberReady(this.state.code, step);
    return this.send({ t: 'ready', step }, { quiet: true });
  }
  advance(): Promise<Reply> {
    const step = this.state.game?.step ?? -1;
    return this.send({ t: 'advance', step });
  }
  chat(text: string): Promise<Reply> {
    return this.send({ t: 'chat', text });
  }

  addNote(text: string): void {
    const notes = [...this.state.notes, { id: Date.now(), text, at: Date.now() }].slice(-100);
    saveNotes(this.state.code, notes);
    this.set({ notes });
  }

  private clearNotes(): void {
    if (this.state.notes.length === 0) return;
    saveNotes(this.state.code, []);
    this.set({ notes: [] });
  }

  setChatOpen(open: boolean): void {
    this.chatOpen = open;
    if (open && this.state.unreadChat > 0) this.set({ unreadChat: 0 });
  }

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    const toast = { id: toastSeq++, text, tone };
    this.set({ toast });
    setTimeout(() => {
      if (this.state.toast?.id === toast.id) this.set({ toast: null });
    }, 3500);
  }

  // ───────────────────────────── отладка и тесты ─────────────────────────────

  /** Подставить состояние напрямую (компонентные тесты и демонстрационные экраны). */
  inject(patch: Partial<RoomViewState>): void {
    this.set(patch);
  }
}

function notesKey(code: string): string {
  return `mafia.notes.${code}`;
}

function loadNotes(code: string): Note[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(notesKey(code)) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Note[]).filter((n) => n && typeof n.text === 'string') : [];
  } catch {
    return [];
  }
}

function saveNotes(code: string, notes: Note[]): void {
  try {
    if (notes.length === 0) localStorage.removeItem(notesKey(code));
    else localStorage.setItem(notesKey(code), JSON.stringify(notes));
  } catch {
    // без сохранения
  }
}

function sortEvents(events: ViewEvent[]): ViewEvent[] {
  return [...events].sort((a, b) => a.id - b.id);
}

function mergeScenes(prev: Scene[], next: Scene[]): Scene[] {
  if (next.length === 0) return prev;
  const known = new Set(prev.map((s) => s.id));
  return [...prev, ...next.filter((s) => !known.has(s.id))];
}
