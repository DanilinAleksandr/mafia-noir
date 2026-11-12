/**
 * Партия ботов против настоящего сервера — с журналом в консоли.
 *
 *   npm run bots                              сам поднимет локальный сервер и сыграет партию
 *   npm run bots -- --url http://127.0.0.1:8787   сыграть на уже запущенном `wrangler dev`
 *   npm run bots -- --players 10 --seed 5 --display cinema --games 2 --quiet
 *   npm run bots -- --url http://127.0.0.1:8787 --join ABCDE --password 1234 --count 4
 *                                             подсадить ботов в вашу комнату и играть вместе с ними
 *
 * Боты ходят по сети через WebSocket и видят только то, что видел бы обычный клиент.
 * Сеть наружу не нужна: всё работает на 127.0.0.1.
 */
import { ROLES } from '@mafia/engine';
import type { RoleId, ViewEvent } from '@mafia/engine';
import { PROTOCOL_VERSION } from '@mafia/protocol';
import type {
  ClientMessage,
  CreateRoomResponse,
  DisplayMode,
  GameSnapshot,
  RoomSnapshot,
  ServerMessage,
} from '@mafia/protocol';
import { type BotMemory, botMove, newBotMemory, seededRandom } from './bot';

interface Options {
  url: string | null;
  players: number;
  seed: number;
  display: DisplayMode;
  games: number;
  quiet: boolean;
  /** Код комнаты, в которую нужно подсадить ботов (вместо собственной партии). */
  join: string | null;
  password: string;
  count: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { url: null, players: 8, seed: Date.now() % 100000, display: 'stealth', games: 1, quiet: false, join: null, password: '1234', count: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`У параметра ${arg} нет значения`);
      return value;
    };
    if (arg === '--url') options.url = next().replace(/\/$/, '');
    else if (arg === '--players') options.players = Number(next());
    else if (arg === '--seed') options.seed = Number(next());
    else if (arg === '--display') options.display = next() as DisplayMode;
    else if (arg === '--games') options.games = Number(next());
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--join') options.join = next().toUpperCase();
    else if (arg === '--password') options.password = next();
    else if (arg === '--count') options.count = Number(next());
    else if (arg === '--help' || arg === '-h') {
      console.log('Параметры: --url <адрес> --players <4..20> --seed <число> --display stealth|open|cinema --games <число> --quiet\n           --join <код> --password <пароль> --count <сколько ботов подсадить>');
      process.exit(0);
    } else throw new Error(`Неизвестный параметр: ${arg}`);
  }
  if (!(options.players >= 4 && options.players <= 20)) throw new Error('Игроков должно быть от 4 до 20');
  return options;
}

/** Бот: соединение, последнее состояние и всё, что он получил. */
class Bot {
  readonly name: string;
  readonly memory: BotMemory = newBotMemory();
  memberId = '';
  token = '';
  room: RoomSnapshot | null = null;
  game: GameSnapshot | null = null;
  events: ViewEvent[] = [];
  rev = 0;
  received = 0;
  private ws!: WebSocket;
  private nextId = 1;
  private replies = new Map<number, (message: ServerMessage) => void>();
  private watchers: (() => void)[] = [];
  private failure: string | null = null;
  /** Вызывается после каждого сообщения сервера. */
  onUpdate: (() => void) | null = null;

  get closed(): boolean {
    return this.failure !== null;
  }

  constructor(name: string) {
    this.name = name;
  }

  connect(base: string, code: string, hello: { token: string } | { name: string; password: string }): Promise<void> {
    const url = `${base.replace(/^http/, 'ws')}/api/rooms/${code}/ws`;
    this.ws = new WebSocket(url);
    return new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, ...hello })));
      this.ws.addEventListener('error', () => reject(new Error(`${this.name}: не удалось подключиться к ${url}`)));
      this.ws.addEventListener('close', (event) => {
        this.failure = `соединение закрыто (${event.code} ${event.reason})`;
        reject(new Error(`${this.name}: ${this.failure}`));
        this.notify();
      });
      this.ws.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.received++;
        this.onMessage(message);
        if (message.t === 'welcome') resolve();
        if (message.t === 'error' && this.memberId === '') reject(new Error(`${this.name}: ${message.code} ${message.message}`));
      });
    });
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.memberId = message.memberId;
        if (message.token) this.token = message.token;
        this.room = message.room;
        this.game = message.game;
        this.events = [...message.history];
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
        this.rev = Math.max(this.rev, message.game.rev);
        break;
      case 'ack':
      case 'error':
        if (message.re !== null) {
          this.replies.get(message.re)?.(message);
          this.replies.delete(message.re);
        }
        break;
      default:
        break;
    }
    this.notify();
  }

  private notify(): void {
    for (const watcher of this.watchers.splice(0)) watcher();
    this.onUpdate?.();
  }

  /** Отправить сообщение и дождаться подтверждения или ошибки. */
  request(message: ClientMessage): Promise<ServerMessage> {
    const id = this.nextId++;
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: нет ответа на ${message.t}`)), 10_000);
      this.replies.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.ws.send(JSON.stringify({ ...message, id }));
    });
  }

  /** Дождаться рассылки с номером не меньше `rev`. */
  async untilRev(rev: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (this.rev < rev) {
      if (this.failure) throw new Error(`${this.name}: ${this.failure}`);
      if (Date.now() > deadline) throw new Error(`${this.name}: не дождался рассылки №${rev}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 200);
        this.watchers.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close(): void {
    this.failure = 'закрыто';
    this.ws.close(1000, 'конец');
  }
}

const STAGE_NAMES: Record<string, string> = {
  night: 'Ночь',
  decision: 'Решение',
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
  ended: 'Конец',
};

function describeMove(move: ClientMessage, name: (id: string | null) => string): string {
  switch (move.t) {
    case 'night':
      if (move.action.kind === 'pass') return 'ночной ход: пропуск';
      if (move.action.kind === 'mafiaVote') return `голос мафии: ${name(move.action.target)}`;
      return `способность ${move.action.ability}: ${move.action.targets.map(name).join(', ')}`;
    case 'vote':
      return `голос: ${name(move.target)}`;
    case 'decision':
      if (move.decision.kind === 'judgeVeto') return `решение Судьи: ${move.decision.veto ? 'отменить' : 'не отменять'}`;
      return `решение ${move.decision.kind}: ${name(move.decision.target)}`;
    case 'ready':
      return 'готов';
    case 'chat':
      return `чат мафии: «${move.text}»`;
    default:
      return move.t;
  }
}

async function playGame(base: string, options: Options, gameIndex: number): Promise<void> {
  const log = (line: string): void => {
    if (!options.quiet) console.log(line);
  };
  const random = seededRandom(options.seed + gameIndex);

  // комната и игроки
  const created = (await (
    await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Бот 1', password: 'боты' }),
    })
  ).json()) as CreateRoomResponse;
  console.log(`\n=== Партия ${gameIndex + 1}: комната ${created.code}, ссылка ${base}/r/${created.code}, игроков ${options.players}, seed ${options.seed + gameIndex}, режим ${options.display} ===`);

  const bots: Bot[] = [];
  const host = new Bot('Бот 1');
  await host.connect(base, created.code, { token: created.token });
  bots.push(host);
  for (let i = 2; i <= options.players; i++) {
    const bot = new Bot(`Бот ${i}`);
    await bot.connect(base, created.code, { name: bot.name, password: 'боты' });
    bots.push(bot);
  }
  const nameOf = (id: string | null): string =>
    id === null ? 'никто' : (host.room?.members.find((m) => m.id === id)?.name ?? id);
  const settle = async (rev: number): Promise<void> => {
    await Promise.all(bots.map((b) => b.untilRev(rev)));
  };
  const send = async (bot: Bot, message: ClientMessage): Promise<boolean> => {
    const reply = await bot.request(message);
    if (reply.t === 'error') {
      if (reply.code === 'STALE' || reply.code === 'WRONG_STAGE') return false;
      throw new Error(`${bot.name}: сервер отклонил ${message.t} — ${reply.code} ${reply.message}`);
    }
    if (reply.t === 'ack') await settle(reply.rev);
    return true;
  };

  await send(host, { t: 'settings', patch: { display: options.display } });
  await send(host, { t: 'start' });

  // журнал: каждое событие печатается один раз — в самом полном виде, какой получил хоть один бот
  let printed = 0;
  let lastStage = '';
  const flush = (): void => {
    const best = new Map<number, { event: ViewEvent; full: number; seen: number }>();
    for (const bot of bots) {
      for (const event of bot.events) {
        if (event.id <= printed) continue;
        const entry = best.get(event.id) ?? { event, full: 0, seen: 0 };
        entry.seen++;
        if (!event.redacted) {
          entry.full++;
          entry.event = event;
        }
        best.set(event.id, entry);
      }
    }
    for (const id of [...best.keys()].sort((a, b) => a - b)) {
      const { event, full, seen } = best.get(id) as { event: ViewEvent; full: number; seen: number };
      const who = [event.actors.map(nameOf).join(', '), event.targets.map(nameOf).join(', ')].filter(Boolean).join(' → ');
      const data = Object.keys(event.data).length > 0 && event.type !== 'gameEnded' ? ` ${JSON.stringify(event.data)}` : '';
      log(`    #${String(id).padStart(3)} ${event.type}${who ? `: ${who}` : ''}${data}   [видят ${seen} из ${bots.length}, целиком ${full}]`);
      printed = id;
    }
    const game = host.game;
    if (game && `${game.stage}/${game.view.round}/${game.step}` !== lastStage) {
      lastStage = `${game.stage}/${game.view.round}/${game.step}`;
      log(`  — ${STAGE_NAMES[game.stage]} ${game.view.round} (шаг ${game.step}) —`);
    }
  };
  flush();

  let actions = 0;
  let forced = 0;
  while (host.game && host.game.stage !== 'ended') {
    let acted = false;
    for (const bot of bots) {
      if (!bot.game || bot.game.stage === 'ended') continue;
      const move = botMove(bot.game, bot.memory, random);
      if (!move) continue;
      log(`      ${bot.name} → ${describeMove(move, nameOf)}`);
      await send(bot, move);
      actions++;
      acted = true;
      flush();
    }
    if (!acted) {
      // никто не может ходить — хост жмёт «дальше»
      log('      хост → дальше');
      await send(host, { t: 'advance', step: host.game.step });
      forced++;
      flush();
    }
    if (actions > 5000) throw new Error('Партия не закончилась за 5000 действий');
  }
  flush();

  // итог
  const view = host.game?.view;
  const result = view?.result;
  if (!view || !result) throw new Error('Партия закончилась без итога');
  const outcomes: Record<string, string> = { red: 'красные', black: 'чёрные', maniac: 'Маньяк', jester: 'Шут', draw: 'ничья' };
  console.log(`  Итог: ${outcomes[result.outcome]} (${result.reason}). Победители: ${result.winners.map(nameOf).join(', ') || 'нет'}`);
  console.log(
    `  Роли: ${view.players.map((p) => `${p.name} — ${ROLES[p.role as RoleId].name}${p.alive ? '' : ' †'}`).join('; ')}`,
  );
  console.log(
    `  Кругов: ${view.round}, действий ботов: ${actions}, принудительных шагов: ${forced}, сообщений от сервера: ${bots.reduce((sum, b) => sum + b.received, 0)}`,
  );

  // простая самопроверка: каждый бот узнал при раздаче ровно одну роль — свою
  for (const bot of bots) {
    const assigned = bot.events.filter((e) => e.type === 'roleAssigned');
    if (assigned.length !== 1 || assigned[0]?.targets[0] !== bot.memberId) {
      throw new Error(`${bot.name} получил чужую раздачу ролей`);
    }
  }
  for (const bot of bots) bot.close();
}

/** Подсадить ботов в существующую комнату: они ходят сами, как только от них что-то требуется. */
async function joinRoom(base: string, options: Options): Promise<void> {
  const code = options.join as string;
  const random = seededRandom(options.seed);
  const bots: Bot[] = [];
  for (let i = 1; i <= options.count; i++) {
    const bot = new Bot(`Бот ${i}`);
    await bot.connect(base, code, { name: bot.name, password: options.password });
    bots.push(bot);
  }
  console.log(`В комнату ${code} вошли боты: ${bots.map((b) => b.name).join(', ')}.`);
  console.log(`Откройте ${base}/r/${code}, начните игру — боты будут ходить сами. Остановить: Ctrl+C.`);

  const busy = new Set<Bot>();
  const pump = async (bot: Bot): Promise<void> => {
    if (busy.has(bot)) return;
    busy.add(bot);
    try {
      for (;;) {
        if (bot.closed || !bot.game || bot.game.stage === 'ended') return;
        const move = botMove(bot.game, bot.memory, random);
        if (!move) return;
        // небольшая пауза, чтобы за ходами можно было следить
        await new Promise((resolve) => setTimeout(resolve, 400 + Math.floor(random() * 600)));
        if (bot.closed) return;
        const nameOf = (id: string | null): string =>
          id === null ? 'никто' : (bot.room?.members.find((m) => m.id === id)?.name ?? id);
        if (!options.quiet) console.log(`  ${bot.name} → ${describeMove(move, nameOf)}`);
        const reply = await bot.request(move);
        if (reply.t === 'error' && reply.code !== 'STALE' && reply.code !== 'WRONG_STAGE') {
          console.log(`  ${bot.name}: сервер ответил ${reply.code} — ${reply.message}`);
          return;
        }
      }
    } catch (error) {
      console.log(`  ${bot.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy.delete(bot);
    }
  };
  for (const bot of bots) {
    bot.onUpdate = () => void pump(bot);
    void pump(bot);
  }
  // работаем, пока боты в комнате (их исключили, комнату закрыли или нажали Ctrl+C)
  while (bots.some((b) => !b.closed)) await new Promise((resolve) => setTimeout(resolve, 500));
  console.log('Все боты отключены.');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let base = options.url;
  let stop: (() => Promise<void>) | null = null;

  if (!base) {
    // свой локальный сервер: тот же wrangler dev, только запущенный из скрипта
    process.env.WRANGLER_SEND_METRICS = 'false';
    const { unstable_dev } = await import('wrangler');
    const worker = await unstable_dev('src/index.ts', {
      config: 'wrangler.jsonc',
      local: true,
      persist: false,
      logLevel: 'error',
      experimental: { disableExperimentalWarning: true },
    });
    base = `http://${worker.address}:${worker.port}`;
    stop = worker.stop;
    console.log(`Локальный сервер запущен: ${base}`);
  } else {
    console.log(`Используется запущенный сервер: ${base}`);
  }

  try {
    if (options.join) {
      await joinRoom(base, options);
    } else {
      for (let i = 0; i < options.games; i++) await playGame(base, options, i);
      console.log('\nГотово: все партии доиграны.');
    }
  } finally {
    if (stop) await stop();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`\nОшибка: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
