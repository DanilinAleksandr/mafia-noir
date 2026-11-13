/**
 * Комната — один Durable Object на комнату.
 *
 * - Вся игровая логика выполняется здесь через движок; клиент получает только `viewFor` и события
 *   в своей видимости.
 * - Соединения — WebSocket Hibernation: объект может уснуть между сообщениями, поэтому всё состояние
 *   лежит в хранилище (один ключ `room`), а о соединении известно только то, что записано в его
 *   attachment.
 * - Один будильник на объект обслуживает все таймеры: таймер стадии, утреннюю синхронизацию,
 *   передачу хоста и удаление комнаты по простою.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  EngineError,
  allNightMovesDone,
  allVotesIn,
  castVote,
  createGame,
  currentDecision,
  generateComposition,
  nightMoveDone,
  projectEvents,
  resolveNight,
  resolvePendingDefault,
  resolveVote,
  submitDecision,
  submitNightAction,
  viewFor,
} from '@mafia/engine';
import type { GameEvent, GameState, StepResult, ViewOptions } from '@mafia/engine';
import {
  CLOSE_CODES,
  ERROR_MESSAGES,
  LIMITS,
  PROTOCOL_VERSION,
  applySettingsPatch,
  defaultRoomSettings,
  engineErrorCode,
  isValidPassword,
  normalizeName,
  parseClientMessage,
} from '@mafia/protocol';
import type {
  ClientMessage,
  ErrorCode,
  GameSnapshot,
  GameStage,
  HostMode,
  MemberId,
  MemberInfo,
  RoomInfoResponse,
  RoomSnapshot,
  ServerMessage,
} from '@mafia/protocol';
import { type PasswordHash, hashPassword, hashToken, newSeed, newToken, verifyPassword } from './crypto';
import { compositionOf, personalScenes, stageOf } from './game-view';
import { LIMITS_SERVER, ROOM_STATE_VERSION, type Member, type RoomState, type SocketAttachment } from './state';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  GATE: DurableObjectNamespace<import('./gate').Gate>;
}

/** Ошибка, которую нужно вернуть клиенту как есть. */
class ProtocolError extends Error {
  readonly code: ErrorCode;
  /** Закрыть ли соединение после ошибки (отказ во входе). */
  readonly fatal: boolean;

  constructor(code: ErrorCode, detail?: string, fatal = false) {
    super(detail ?? ERROR_MESSAGES[code]);
    this.code = code;
    this.fatal = fatal;
  }
}

interface LiveSocket {
  ws: WebSocket;
  att: SocketAttachment;
}

const OPEN = 1;

export class Room extends DurableObject<Env> {
  /** Состояние комнаты; null — комнаты нет. Открыто для тестов. */
  room: RoomState | null = null;
  /** Сдвиг часов, мс. Только для тестов: позволяет «перемотать» время. */
  skewMs = 0;

  private dirty = false;
  private roomTouched = false;
  private gameTouched = false;
  private events: GameEvent[] = [];
  private welcome: { ws: WebSocket; member: Member; token: string | null } | null = null;
  private creating = false;
  private rate = new Map<MemberId, { count: number; start: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Ответ на «ping» без пробуждения объекта: клиент держит соединение живым бесплатно.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomState>('room');
      if (stored && stored.v !== ROOM_STATE_VERSION) {
        // комната сохранена старой версией сервера: формат другой, продолжать её нельзя
        await ctx.storage.deleteAlarm();
        await ctx.storage.deleteAll();
        return;
      }
      this.room = stored ?? null;
    });
  }

  private now(): number {
    return Date.now() + this.skewMs;
  }

  // ───────────────────────────── вызовы из Worker ─────────────────────────────

  /** Создать комнату. Возвращает null, если код уже занят. */
  async createRoom(input: {
    code: string;
    name: string;
    password: string;
    hostMode: HostMode;
  }): Promise<{ memberId: MemberId; token: string } | null> {
    if (this.room || this.creating) return null;
    this.creating = true;
    const now = this.now();
    const token = newToken();
    let tokenHash: string;
    let password: PasswordHash;
    try {
      tokenHash = await hashToken(token);
      password = await hashPassword(input.password);
    } finally {
      this.creating = false;
    }
    const host: Member = { id: 'm1', name: input.name, tokenHash, joinedAt: now };
    this.room = {
      v: ROOM_STATE_VERSION,
      code: input.code,
      createdAt: now,
      lastActivityAt: now,
      password,
      hostId: host.id,
      // хост ещё не подключился по WebSocket; отсчёт до передачи прав начнётся, когда он уйдёт
      hostOfflineSince: null,
      members: [host],
      nextMemberSeq: 2,
      settings: defaultRoomSettings(input.hostMode),
      stage: 'lobby',
      game: null,
      players: [],
      rev: 0,
      step: 0,
      sync: null,
      discussion: false,
      stageDeadline: null,
      chat: [],
      chatSeq: 0,
      attempts: {},
      idleCheckAt: now + LIMITS_SERVER.idleMs,
      alarmAt: null,
    };
    this.dirty = true;
    await this.commit();
    return { memberId: host.id, token };
  }

  /** Краткие сведения о комнате для страницы входа. null — комнаты нет. */
  async info(): Promise<RoomInfoResponse | null> {
    const room = this.room;
    if (!room) return null;
    return {
      code: room.code,
      stage: room.stage,
      members: room.members.length,
      joinable: room.stage === 'lobby' && room.members.length < LIMITS.maxMembers,
    };
  }

  /** Открыть WebSocket. Вход в комнату происходит первым сообщением `hello`. */
  override async fetch(request: Request): Promise<Response> {
    if (!this.room) return errorResponse('ROOM_NOT_FOUND', 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Ожидается WebSocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= LIMITS_SERVER.maxSockets) return errorResponse('ROOM_BUSY', 503);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = { m: null, ip: request.headers.get('CF-Connecting-IP') ?? 'local' };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ───────────────────────────── события WebSocket ─────────────────────────────

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    if (!room) {
      this.bye(ws, 'ROOM_CLOSED', CLOSE_CODES.ROOM_CLOSED);
      return;
    }
    const att = ws.deserializeAttachment() as SocketAttachment;
    const parsed = parseClientMessage(typeof raw === 'string' ? raw : null);
    if (!parsed.ok) {
      this.send(ws, { t: 'error', code: parsed.code, message: parsed.message, re: parsed.re });
      // до входа любое непонятное сообщение — повод закрыть соединение
      if (!att.m) this.close(ws, CLOSE_CODES.REJECTED, parsed.code);
      return;
    }
    const msg = parsed.value;
    const re = msg.id ?? null;

    try {
      if (msg.t === 'hello') {
        await this.onHello(ws, att, msg);
      } else {
        if (!att.m) throw new ProtocolError('NOT_AUTHENTICATED', undefined, true);
        const member = room.members.find((m) => m.id === att.m);
        if (!member) throw new ProtocolError('BAD_TOKEN', undefined, true);
        this.checkRate(member.id);
        room.lastActivityAt = this.now();
        this.dispatch(member, msg);
      }
      await this.commit();
      // после commit комнаты может уже не быть (последний участник вышел)
      if (re !== null && ws.readyState === OPEN) this.send(ws, { t: 'ack', re, rev: this.room?.rev ?? 0 });
    } catch (error) {
      await this.fail(ws, error, re);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
    try {
      ws.close(CLOSE_CODES.NORMAL, 'closed');
    } catch {
      // соединение уже закрыто
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  override async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = this.now();
    room.alarmAt = null;
    this.dirty = true;

    if (now >= room.idleCheckAt) {
      if (now - room.lastActivityAt >= LIMITS_SERVER.idleMs) {
        await this.destroy('ROOM_CLOSED');
        return;
      }
      room.idleCheckAt = room.lastActivityAt + LIMITS_SERVER.idleMs;
    }
    try {
      this.maybeTransferHost(now);
      if (room.stage === 'game' && room.game) {
        if (room.sync && now >= room.sync.deadline) this.openGate();
        else if (room.stageDeadline !== null && now >= room.stageDeadline) this.forceAdvance();
      }
    } catch (error) {
      // ошибка в таймере не должна зацикливать будильник: сбрасываем срок и идём дальше
      console.error('Комната: ошибка в будильнике', error);
      room.stageDeadline = null;
    }
    await this.commit();
  }

  // ───────────────────────────── вход ─────────────────────────────

  private async onHello(ws: WebSocket, att: SocketAttachment, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (att.m) throw new ProtocolError('ALREADY_AUTHENTICATED');
    if (msg.v !== PROTOCOL_VERSION) throw new ProtocolError('PROTOCOL_VERSION', undefined, true);

    // Криптография асинхронна, и пока она считается, объект может обработать чужое сообщение.
    // Поэтому сначала считаем всё, что нужно, а состояние комнаты читаем и меняем уже после — без пауз.
    let name: string | null = null;
    let tokenHash: string;
    let token: string | null = null;
    let passwordOk = false;

    if (msg.token !== undefined) {
      tokenHash = await hashToken(msg.token);
    } else {
      name = normalizeName(msg.name);
      if (name === null) throw new ProtocolError('BAD_NAME', undefined, true);
      if (!isValidPassword(msg.password)) throw new ProtocolError('BAD_PASSWORD', undefined, true);
      // дешёвые отказы — до дорогой проверки пароля
      this.assertJoinable(att.ip);
      passwordOk = await verifyPassword(msg.password, (this.room as RoomState).password);
      token = newToken();
      tokenHash = await hashToken(token);
    }

    const room = this.room;
    if (!room) throw new ProtocolError('ROOM_NOT_FOUND', undefined, true);
    const now = this.now();
    let member: Member | undefined;

    if (name === null) {
      // переподключение по токену
      member = room.members.find((m) => m.tokenHash === tokenHash);
      if (!member) throw new ProtocolError('BAD_TOKEN', undefined, true);
      token = null;
    } else {
      // первый вход: имя и пароль
      this.assertJoinable(att.ip);
      if (!passwordOk) {
        const left = this.registerFailure(att.ip, now);
        this.dirty = true;
        await this.commit();
        throw new ProtocolError(
          left > 0 ? 'WRONG_PASSWORD' : 'TOO_MANY_ATTEMPTS',
          left > 0 ? `Неверный пароль. Осталось попыток: ${left}` : undefined,
          true,
        );
      }
      const lower = name.toLocaleLowerCase('ru');
      if (room.members.some((m) => m.name.toLocaleLowerCase('ru') === lower)) {
        throw new ProtocolError('NAME_TAKEN', undefined, true);
      }
      delete room.attempts[`ip:${att.ip}`];
      member = { id: `m${room.nextMemberSeq++}`, name, tokenHash, joinedAt: now };
      room.members.push(member);
    }

    // одно соединение на участника: старое закрывается
    for (const other of this.sockets()) {
      if (other.att.m === member.id && other.ws !== ws) {
        this.bye(other.ws, 'REPLACED', CLOSE_CODES.REPLACED);
      }
    }
    ws.serializeAttachment({ ...att, m: member.id } satisfies SocketAttachment);
    if (member.id === room.hostId) room.hostOfflineSince = null;
    this.maybeTransferHost(now);

    room.lastActivityAt = now;
    this.dirty = true;
    this.roomTouched = true;
    this.welcome = { ws, member, token };
  }

  /** Можно ли сейчас войти новому игроку с этого адреса. */
  private assertJoinable(ip: string): void {
    const room = this.room;
    if (!room) throw new ProtocolError('ROOM_NOT_FOUND', undefined, true);
    if (room.stage !== 'lobby') throw new ProtocolError('ROOM_STARTED', undefined, true);
    if (room.members.length >= LIMITS.maxMembers) throw new ProtocolError('ROOM_FULL', undefined, true);
    this.assertNotLocked(ip, this.now());
  }

  private assertNotLocked(ip: string, now: number): void {
    const room = this.room as RoomState;
    for (const key of [`ip:${ip}`, 'room']) {
      const entry = room.attempts[key];
      if (entry && entry.lockedUntil > now) throw new ProtocolError('TOO_MANY_ATTEMPTS', undefined, true);
    }
  }

  /** Записать неверную попытку. Возвращает, сколько попыток осталось у этого адреса. */
  private registerFailure(ip: string, now: number): number {
    const room = this.room as RoomState;
    // заодно убираем устаревшие записи
    for (const [key, entry] of Object.entries(room.attempts)) {
      const expired = now - entry.windowStart > LIMITS_SERVER.attemptsWindowMs && entry.lockedUntil <= now;
      if (expired) delete room.attempts[key];
    }
    const bump = (key: string, max: number): number => {
      let entry = room.attempts[key];
      if (!entry || now - entry.windowStart > LIMITS_SERVER.attemptsWindowMs) {
        entry = { count: 0, windowStart: now, lockedUntil: 0 };
      }
      entry.count += 1;
      if (entry.count >= max) entry.lockedUntil = now + LIMITS_SERVER.attemptsLockMs;
      room.attempts[key] = entry;
      return Math.max(0, max - entry.count);
    };
    bump('room', LIMITS_SERVER.attemptsPerRoom);
    return bump(`ip:${ip}`, LIMITS_SERVER.attemptsPerIp);
  }

  private checkRate(memberId: MemberId): void {
    const now = Date.now();
    let entry = this.rate.get(memberId);
    if (!entry || now - entry.start > LIMITS_SERVER.rateWindowMs) entry = { count: 0, start: now };
    entry.count += 1;
    this.rate.set(memberId, entry);
    if (entry.count > LIMITS_SERVER.rateCount) throw new ProtocolError('RATE_LIMITED');
  }

  // ───────────────────────────── сообщения ─────────────────────────────

  private dispatch(member: Member, msg: Exclude<ClientMessage, { t: 'hello' }>): void {
    const room = this.room as RoomState;
    const isHost = member.id === room.hostId;
    const hostOnly = (): void => {
      if (!isHost) throw new ProtocolError('NOT_HOST');
    };
    const inLobby = (): void => {
      if (room.stage !== 'lobby') throw new ProtocolError('WRONG_STAGE');
    };

    switch (msg.t) {
      case 'settings':
        hostOnly();
        inLobby();
        room.settings = applySettingsPatch(room.settings, msg.patch);
        this.touchRoom();
        return;

      case 'kick': {
        hostOnly();
        if (room.stage === 'game') throw new ProtocolError('WRONG_STAGE', 'Во время партии исключать нельзя');
        if (msg.memberId === member.id) throw new ProtocolError('UNKNOWN_MEMBER', 'Себя исключить нельзя');
        if (!room.members.some((m) => m.id === msg.memberId)) throw new ProtocolError('UNKNOWN_MEMBER');
        this.removeMember(msg.memberId, 'KICKED');
        return;
      }

      case 'transferHost': {
        hostOnly();
        if (!room.members.some((m) => m.id === msg.memberId)) throw new ProtocolError('UNKNOWN_MEMBER');
        room.hostId = msg.memberId;
        room.hostOfflineSince = this.onlineIds().has(msg.memberId) ? null : this.now();
        this.touchRoom();
        return;
      }

      case 'leave':
        if (room.stage === 'game') {
          throw new ProtocolError('WRONG_STAGE', 'Во время партии выйти нельзя: просто закройте страницу');
        }
        this.removeMember(member.id, 'LEFT');
        return;

      case 'start':
        hostOnly();
        inLobby();
        this.startGame();
        return;

      case 'toLobby':
        hostOnly();
        if (room.stage === 'lobby') throw new ProtocolError('WRONG_STAGE');
        room.stage = 'lobby';
        room.game = null;
        room.players = [];
        room.sync = null;
        room.discussion = false;
        room.stageDeadline = null;
        room.chat = [];
        this.touchRoom();
        return;

      case 'night': {
        const game = this.gameAt('night');
        this.assertPlaying(member.id);
        this.apply(submitNightAction(game, member.id, msg.action));
        if (allNightMovesDone(room.game as GameState)) this.resolve(resolveNight(room.game as GameState));
        return;
      }

      case 'vote': {
        const game = this.gameAt('day');
        this.assertPlaying(member.id);
        this.apply(castVote(game, member.id, msg.target));
        if (allVotesIn(room.game as GameState)) this.resolve(resolveVote(room.game as GameState));
        return;
      }

      case 'decision': {
        const game = this.gameAt('decision');
        this.assertPlaying(member.id);
        this.resolve(submitDecision(game, member.id, msg.decision));
        return;
      }

      case 'ready': {
        // опоздавший «готов» — не ошибка: игра могла пойти дальше по таймеру
        if (room.stage !== 'game' || !room.sync || msg.step !== room.step) return;
        if (!room.sync.ready.includes(member.id)) {
          room.sync.ready.push(member.id);
          this.dirty = true;
          this.gameTouched = true;
        }
        this.maybeOpenGate();
        return;
      }

      case 'advance':
        hostOnly();
        if (room.stage !== 'game' || !room.game) throw new ProtocolError('WRONG_STAGE');
        if (msg.step !== room.step) throw new ProtocolError('STALE');
        if (stageOf(room) === 'ended') throw new ProtocolError('WRONG_STAGE');
        this.forceAdvance();
        return;

      case 'chat':
        this.onChat(member, msg.text);
        return;
    }
  }

  private gameAt(stage: GameStage): GameState {
    const room = this.room as RoomState;
    if (room.stage !== 'game' || !room.game || stageOf(room) !== stage) throw new ProtocolError('WRONG_STAGE');
    return room.game;
  }

  private assertPlaying(memberId: MemberId): void {
    if (!(this.room as RoomState).players.includes(memberId)) throw new ProtocolError('NOT_PLAYING');
  }

  private touchRoom(): void {
    this.dirty = true;
    this.roomTouched = true;
  }

  // ───────────────────────────── участники ─────────────────────────────

  private removeMember(memberId: MemberId, reason: 'KICKED' | 'LEFT'): void {
    const room = this.room as RoomState;
    for (const socket of this.sockets()) {
      if (socket.att.m === memberId) this.bye(socket.ws, reason, CLOSE_CODES.REMOVED);
    }
    room.members = room.members.filter((m) => m.id !== memberId);
    this.rate.delete(memberId);
    if (room.hostId === memberId && room.members.length > 0) {
      const online = this.onlineIds();
      const next = room.members.find((m) => online.has(m.id)) ?? (room.members[0] as Member);
      room.hostId = next.id;
      room.hostOfflineSince = online.has(next.id) ? null : this.now();
    }
    this.touchRoom();
  }

  /** Передать права хоста, если он не в сети дольше положенного и есть кому передать. */
  private maybeTransferHost(now: number): void {
    const room = this.room as RoomState;
    if (room.hostOfflineSince === null || now - room.hostOfflineSince < LIMITS_SERVER.hostGraceMs) return;
    const online = this.onlineIds();
    const next = room.members.find((m) => m.id !== room.hostId && online.has(m.id));
    if (!next) return;
    room.hostId = next.id;
    room.hostOfflineSince = null;
    this.touchRoom();
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const room = this.room;
    if (!room) return;
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att?.m) return;
    const memberId = att.m;
    if (!room.members.some((m) => m.id === memberId)) return;
    // у участника могло остаться другое соединение (переподключился раньше, чем закрылось старое)
    if (this.sockets(ws).some((s) => s.att.m === memberId)) return;

    if (memberId === room.hostId && room.hostOfflineSince === null) {
      room.hostOfflineSince = this.now();
      this.dirty = true;
    }
    this.roomTouched = true;
    if (room.stage === 'game' && room.sync) {
      this.gameTouched = true;
      this.maybeOpenGate(ws);
    }
    await this.commit(ws);
  }

  // ───────────────────────────── партия ─────────────────────────────

  private playingMembers(): Member[] {
    const room = this.room as RoomState;
    return room.members.filter((m) => !(room.settings.hostMode === 'narrator' && m.id === room.hostId));
  }

  private startGame(): void {
    const room = this.room as RoomState;
    const players = this.playingMembers();
    let created: StepResult;
    try {
      created = createGame(
        { rules: room.settings.rules, composition: room.settings.composition },
        players.map((m) => ({ id: m.id, name: m.name })),
        newSeed(),
      );
    } catch (error) {
      if (error instanceof EngineError) throw new ProtocolError('CANNOT_START', error.message);
      throw error;
    }
    room.stage = 'game';
    room.players = players.map((m) => m.id);
    room.game = created.state;
    room.sync = null;
    room.discussion = false;
    room.chat = [];
    room.chatSeq = 0;
    room.step += 1;
    this.events.push(...created.events);
    this.setStageDeadline();
    this.dirty = true;
    this.roomTouched = true;
    this.gameTouched = true;
  }

  /** Принять шаг, который не меняет стадию (ночной ход, голос). */
  private apply(result: StepResult): void {
    (this.room as RoomState).game = result.state;
    this.events.push(...result.events);
    this.dirty = true;
    this.gameTouched = true;
  }

  /** Принять разрешение: ночь, голосование или решение игрока. Шаг партии растёт, таймер стадии заводится заново. */
  private resolve(result: StepResult): void {
    const room = this.room as RoomState;
    const before = room.game as GameState;
    this.apply(result);
    const from = before.phase;
    const to = result.state.phase;
    if (from === 'night' && to === 'day') {
      // ночь закончилась: ждём, пока клиенты покажут её итоги
      room.sync = { kind: 'morning', ready: [], deadline: this.now() + LIMITS_SERVER.syncMs };
    } else if (from === 'day' && to === 'night') {
      // день закончился: ждём, пока клиенты покажут приговор
      room.sync = { kind: 'evening', ready: [], deadline: this.now() + LIMITS_SERVER.syncMs };
    }
    room.step += 1;
    this.setStageDeadline();
    if (result.state.phase === 'ended') {
      room.stage = 'finished';
      room.sync = null;
      this.roomTouched = true;
    }
  }

  private setStageDeadline(): void {
    const room = this.room as RoomState;
    const stage = stageOf(room);
    const seconds =
      stage === 'night'
        ? room.settings.timers.night
        : stage === 'discussion'
          ? room.settings.timers.discussion
          : stage === 'day'
          ? room.settings.timers.day
          : stage === 'decision'
            ? room.settings.timers.decision
            : null;
    room.stageDeadline = seconds === null ? null : this.now() + seconds * 1000;
  }

  /** Пойти дальше (утром — начать день, вечером — ночь), если готовы все, кто в сети. */
  private maybeOpenGate(except?: WebSocket): void {
    const room = this.room as RoomState;
    if (!room.sync) return;
    const online = this.onlineIds(except);
    if (online.size === 0) return;
    const ready = room.sync.ready;
    if ([...online].every((id) => ready.includes(id))) this.openGate();
  }

  private openGate(): void {
    const room = this.room as RoomState;
    if (!room.sync) return;
    room.sync = null;
    // утром начинается день — сперва обсуждение, голосование открывает хост или таймер
    room.discussion = (room.game as GameState).phase === 'day';
    room.step += 1;
    this.setStageDeadline();
    this.dirty = true;
    this.gameTouched = true;
  }

  /** Закончить обсуждение и открыть голосование. */
  private startVoting(): void {
    const room = this.room as RoomState;
    room.discussion = false;
    room.step += 1;
    this.setStageDeadline();
    this.dirty = true;
    this.gameTouched = true;
  }

  /** Продвинуть игру без ожидания: по таймеру или по кнопке хоста. */
  private forceAdvance(): void {
    const room = this.room as RoomState;
    const game = room.game as GameState;
    switch (stageOf(room)) {
      case 'night':
        this.resolve(resolveNight(game));
        return;
      case 'discussion':
        this.startVoting();
        return;
      case 'day':
        this.resolve(resolveVote(game));
        return;
      case 'decision':
        this.resolve(resolvePendingDefault(game));
        return;
      case 'morning':
      case 'evening':
        this.openGate();
        return;
      case 'ended':
        return;
    }
  }

  private onChat(member: Member, text: string): void {
    const room = this.room as RoomState;
    const game = room.game;
    const player = game?.players.find((p) => p.id === member.id);
    const allowed =
      room.stage === 'game' && game && stageOf(room) === 'night' && player && player.alive && player.team === 'black';
    if (!allowed) throw new ProtocolError('CHAT_FORBIDDEN');

    const message = {
      id: ++room.chatSeq,
      from: member.id,
      name: member.name,
      text,
      at: this.now(),
      round: game.round,
    };
    room.chat.push(message);
    if (room.chat.length > LIMITS_SERVER.chatHistory) room.chat.splice(0, room.chat.length - LIMITS_SERVER.chatHistory);
    this.dirty = true;
    const recipients = this.chatAudience();
    for (const socket of this.sockets()) {
      if (socket.att.m && recipients.has(socket.att.m)) this.send(socket.ws, { t: 'chat', message });
    }
  }

  /** Кому сейчас виден чат мафии: живые чёрные и ведущий-наблюдатель. */
  private chatAudience(): Set<MemberId> {
    const room = this.room as RoomState;
    const game = room.game;
    if (!game) return new Set();
    const audience = new Set(game.players.filter((p) => p.alive && p.team === 'black').map((p) => p.id));
    for (const member of room.members) if (this.seesAll(member.id)) audience.add(member.id);
    return audience;
  }

  // ───────────────────────────── снимки ─────────────────────────────

  private sockets(except?: WebSocket): LiveSocket[] {
    const out: LiveSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== OPEN) continue;
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (att) out.push({ ws, att });
    }
    return out;
  }

  private onlineIds(except?: WebSocket): Set<MemberId> {
    const ids = new Set<MemberId>();
    for (const socket of this.sockets(except)) if (socket.att.m) ids.add(socket.att.m);
    return ids;
  }

  /**
   * Снимок комнаты. Одинаков для всех, кроме одного: в режиме «Скрытный» состав, заданный хостом
   * вручную, виден только хосту — иначе настройки раскрывали бы, какие роли в партии.
   */
  private roomSnapshot(online: Set<MemberId>, forHost: boolean): RoomSnapshot {
    const room = this.room as RoomState;
    const presetHidden = !forHost && room.settings.display === 'stealth' && room.settings.composition.preset !== null;
    const playingNow = new Set(
      room.stage === 'lobby' ? this.playingMembers().map((m) => m.id) : room.players,
    );
    const members: MemberInfo[] = room.members.map((m) => ({
      id: m.id,
      name: m.name,
      online: online.has(m.id),
      isHost: m.id === room.hostId,
      playing: playingNow.has(m.id),
    }));

    let startIssues: string[] = [];
    let startWarnings: string[] = [];
    if (room.stage === 'lobby') {
      const check = generateComposition(
        playingNow.size,
        { rules: room.settings.rules, composition: room.settings.composition },
        'preview',
      );
      if (check.ok) {
        // Состав партии случаен, а это лишь пробная раскладка. Предупреждения, которые зависят
        // от случая («нет информационных ролей»), показываем только для состава, заданного вручную.
        const stable = room.settings.composition.preset !== null;
        startWarnings = check.warnings
          .filter((w) => stable || w.code === 'ROLE_SKIPPED' || w.code === 'CIVILIAN_SHARE_UNMET')
          .map((w) => w.message);
      } else {
        startIssues = check.errors.map((e) => e.message);
      }
    }
    return {
      rev: room.rev,
      code: room.code,
      stage: room.stage,
      hostId: room.hostId,
      members,
      settings: presetHidden
        ? { ...room.settings, composition: { ...room.settings.composition, preset: null } }
        : room.settings,
      presetHidden,
      startIssues,
      // предупреждения называют роли состава — вместе со скрытым составом скрываются и они
      startWarnings: presetHidden ? [] : startWarnings,
    };
  }

  /** Общая для всех часть снимка партии. */
  private gameCommon(online: Set<MemberId>): Omit<GameSnapshot, 'view'> {
    const room = this.room as RoomState;
    const game = room.game as GameState;
    const stage = stageOf(room);
    const alive = game.players.filter((p) => p.alive);

    let progress: GameSnapshot['progress'] = null;
    if (stage === 'night') {
      progress = { done: alive.filter((p) => nightMoveDone(game, p.id)).length, total: alive.length };
    } else if (stage === 'day' && game.day) {
      const votes = game.day.votes;
      progress = { done: alive.filter((p) => votes[p.id] !== undefined).length, total: alive.length };
    } else if (room.sync && (stage === 'morning' || stage === 'evening')) {
      const ready = room.sync.ready;
      progress = { done: [...online].filter((id) => ready.includes(id)).length, total: online.size };
    }
    return {
      rev: room.rev,
      step: room.step,
      stage,
      deadline: room.sync && (stage === 'morning' || stage === 'evening') ? room.sync.deadline : room.stageDeadline,
      serverTime: this.now(),
      display: room.settings.display,
      composition: room.settings.display === 'stealth' ? null : compositionOf(game),
      progress,
    };
  }

  private viewerOf(memberId: MemberId): MemberId | null {
    return (this.room as RoomState).players.includes(memberId) ? memberId : null;
  }

  /**
   * Ведущий-наблюдатель — участник комнаты, который не играет в этой партии. Он видит всё:
   * роли, журнал целиком, чужие ходы и голоса. Игрокам этого не достаётся никогда.
   * (Не играть может только тот, кто был хостом в режиме «ведущий» на момент старта:
   * после старта новые участники в комнату не входят.)
   */
  private seesAll(memberId: MemberId): boolean {
    const room = this.room as RoomState;
    return room.game !== null && !room.players.includes(memberId);
  }

  private viewOptions(memberId: MemberId): ViewOptions | undefined {
    return this.seesAll(memberId) ? { seeAll: true } : undefined;
  }

  private gameSnapshot(memberId: MemberId, common: Omit<GameSnapshot, 'view'>): GameSnapshot {
    const { events: _events, ...view } = viewFor(
      (this.room as RoomState).game as GameState,
      this.viewerOf(memberId),
      this.viewOptions(memberId),
    );
    return { ...common, view };
  }

  /** Личные сцены участника — во всех режимах (в «Скрытном» без ролей), только игрокам. */
  private scenesFor(memberId: MemberId, events: readonly GameEvent[]): ReturnType<typeof personalScenes> {
    const room = this.room as RoomState;
    if (!room.game || !room.players.includes(memberId)) return [];
    return personalScenes(room.game, events, memberId, room.settings.display);
  }

  // ───────────────────────────── запись и рассылка ─────────────────────────────

  /**
   * Завершить обработку: увеличить номер рассылки, переставить будильник, записать состояние
   * и разослать изменения. Каждому участнику уходит не больше одного `room` и одного `game`.
   */
  private async commit(except?: WebSocket): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (room.members.length === 0) {
      await this.destroy('ROOM_CLOSED');
      return;
    }
    const broadcast = this.roomTouched || this.gameTouched;
    if (broadcast) {
      room.rev += 1;
      this.dirty = true;
    }
    await this.scheduleAlarm();
    if (this.dirty) await this.ctx.storage.put('room', room);

    const sockets = this.sockets(except);
    const online = new Set<MemberId>();
    for (const socket of sockets) if (socket.att.m) online.add(socket.att.m);
    const game = room.stage !== 'lobby' ? room.game : null;
    const common = game ? this.gameCommon(online) : null;

    if (this.welcome) {
      const { ws, member, token } = this.welcome;
      const viewer = this.viewerOf(member.id);
      this.send(ws, {
        t: 'welcome',
        v: PROTOCOL_VERSION,
        memberId: member.id,
        token,
        room: this.roomSnapshot(online, member.id === room.hostId),
        game: game && common ? this.gameSnapshot(member.id, common) : null,
        history: game ? projectEvents(game, game.log, viewer, this.viewOptions(member.id)) : [],
        scenes: game ? this.scenesFor(member.id, game.log) : [],
        chat: this.chatAudience().has(member.id) ? room.chat : [],
      });
    }

    if (this.roomTouched) {
      const forHost = JSON.stringify({ t: 'room', room: this.roomSnapshot(online, true) } satisfies ServerMessage);
      const forOthers = JSON.stringify({ t: 'room', room: this.roomSnapshot(online, false) } satisfies ServerMessage);
      for (const socket of sockets) {
        if (socket.att.m) this.sendRaw(socket.ws, socket.att.m === room.hostId ? forHost : forOthers);
      }
    }

    if (this.gameTouched && game && common) {
      const cache = new Map<MemberId, string>();
      for (const socket of sockets) {
        const memberId = socket.att.m;
        // только что вошедший уже получил всё в `welcome`
        if (!memberId || socket.ws === this.welcome?.ws) continue;
        let text = cache.get(memberId);
        if (text === undefined) {
          text = JSON.stringify({
            t: 'game',
            game: this.gameSnapshot(memberId, common),
            events: projectEvents(game, this.events, this.viewerOf(memberId), this.viewOptions(memberId)),
            scenes: this.scenesFor(memberId, this.events),
          } satisfies ServerMessage);
          cache.set(memberId, text);
        }
        this.sendRaw(socket.ws, text);
      }
    }

    this.dirty = false;
    this.roomTouched = false;
    this.gameTouched = false;
    this.events = [];
    this.welcome = null;
  }

  /** Один будильник на все таймеры: заводится на ближайший срок. */
  private async scheduleAlarm(): Promise<void> {
    const room = this.room as RoomState;
    const now = this.now();
    const times = [room.idleCheckAt];
    if (room.stage === 'game') {
      if (room.sync) times.push(room.sync.deadline);
      else if (room.stageDeadline !== null) times.push(room.stageDeadline);
    }
    if (room.hostOfflineSince !== null) {
      const at = room.hostOfflineSince + LIMITS_SERVER.hostGraceMs;
      // срок уже прошёл, а передать права некому — ждём, пока кто-нибудь войдёт
      if (at > now) times.push(at);
    }
    const next = Math.min(...times);
    if (next === room.alarmAt) return;
    await this.ctx.storage.setAlarm(next - this.skewMs);
    room.alarmAt = next;
    this.dirty = true;
  }

  private async destroy(reason: ErrorCode): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === OPEN) this.bye(ws, reason, CLOSE_CODES.ROOM_CLOSED);
    }
    this.room = null;
    this.rate.clear();
    this.dirty = false;
    this.roomTouched = false;
    this.gameTouched = false;
    this.events = [];
    this.welcome = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async fail(ws: WebSocket, error: unknown, re: number | null): Promise<void> {
    // незавершённые изменения в памяти отбрасываем: правда — в хранилище
    const unexpected = !(error instanceof ProtocolError) && !(error instanceof EngineError);
    if (unexpected || this.dirty) {
      this.room = (await this.ctx.storage.get<RoomState>('room')) ?? null;
    }
    this.dirty = false;
    this.roomTouched = false;
    this.gameTouched = false;
    this.events = [];
    this.welcome = null;

    if (error instanceof ProtocolError) {
      this.send(ws, { t: 'error', code: error.code, message: error.message, re });
      if (error.fatal) this.close(ws, CLOSE_CODES.REJECTED, error.code);
    } else if (error instanceof EngineError) {
      this.send(ws, { t: 'error', code: engineErrorCode(error.code), message: error.message, re });
    } else {
      console.error('Комната: непредвиденная ошибка', error);
      this.send(ws, { t: 'error', code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL, re });
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(message));
  }

  private sendRaw(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch {
      // соединение закрылось, пока мы готовили сообщение
    }
  }

  private bye(ws: WebSocket, code: ErrorCode, closeCode: number): void {
    this.send(ws, { t: 'bye', code, message: ERROR_MESSAGES[code] });
    this.close(ws, closeCode, code);
  }

  private close(ws: WebSocket, closeCode: number, reason: string): void {
    try {
      ws.close(closeCode, reason);
    } catch {
      // уже закрыто
    }
  }
}

export function errorResponse(code: ErrorCode, status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message: ERROR_MESSAGES[code] } }, { status, headers });
}
