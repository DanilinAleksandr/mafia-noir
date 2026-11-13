/**
 * Партия ботов поверх тестовых клиентов. Каждый бот действует только по своему снимку —
 * ровно как настоящий клиент.
 */
import { nightMoveDone } from '@mafia/engine';
import type { NightAction, PlayerState } from '@mafia/engine';
import type { RoomState } from '../src/state';
import { type BotMemory, botMove, newBotMemory, seededRandom } from '../tools/bot';
import { type Client, type Table, resetRateLimit } from './harness';

export interface PlayOptions {
  seed: number;
  /** Вызывается после каждого действия, когда рассылка дошла до всех. */
  afterStep?: () => Promise<void>;
  /** Остановиться, когда условие выполнится (проверяется после каждого действия). */
  until?: (state: RoomState) => boolean;
  maxActions?: number;
}

export interface PlayResult {
  state: RoomState;
  /** Сколько сообщений отправили боты. */
  actions: number;
  /** Сколько раз пришлось нажать «дальше» за хоста. */
  forced: number;
}

/** Сыграть партию ботами до конца (или до условия `until`). */
export async function playBots(table: Table, options: PlayOptions): Promise<PlayResult> {
  const random = seededRandom(options.seed);
  const memory = new Map<Client, BotMemory>();
  const max = options.maxActions ?? 4000;
  let actions = 0;
  let forced = 0;

  for (;;) {
    let state = await table.settle();
    if (state.stage !== 'game' || options.until?.(state)) return { state, actions, forced };

    let acted = false;
    for (const client of table.open) {
      // клиент мог отключиться, пока ходили предыдущие
      if (client.closed || !client.game) continue;
      let mem = memory.get(client);
      if (!mem) {
        mem = newBotMemory();
        memory.set(client, mem);
      }
      const move = botMove(client.game, mem, random, { isHost: client.room?.hostId === client.memberId });
      if (!move) continue;
      let reply = await client.request(move);
      if (!reply.ok && reply.code === 'RATE_LIMITED') {
        // бот ходит быстрее человека: окно ограничения «перематываем» и повторяем ход
        await resetRateLimit(table.code);
        reply = await client.request(move);
      }
      // «уже неактуально» — нормальная гонка, остальное — ошибка сценария
      if (!reply.ok && reply.code !== 'STALE' && reply.code !== 'WRONG_STAGE') {
        throw new Error(`Бот ${client.memberId} получил отказ на ${JSON.stringify(move)}: ${reply.code} ${reply.message}`);
      }
      actions++;
      acted = true;
      state = await table.settle();
      await options.afterStep?.();
      if (state.stage !== 'game' || options.until?.(state)) return { state, actions, forced };
      if (actions > max) throw new Error(`Партия не закончилась за ${max} действий`);
    }

    if (!acted) {
      // никто не может ходить (например, решение ждут от отключившегося) — хост жмёт «дальше»
      const hostId = state.hostId;
      const host = table.open.find((c) => c.memberId === hostId) ?? table.open[0];
      if (!host) throw new Error('За столом никого нет');
      const reply = await host.request({ t: 'advance', step: state.step });
      if (!reply.ok && reply.code !== 'STALE') throw new Error(`«Дальше» отклонено: ${reply.code} ${reply.message}`);
      forced++;
      await table.settle();
      await options.afterStep?.();
      if (forced > 200) throw new Error('Слишком много принудительных шагов');
    }
  }
}

/**
 * Провести ночь по сценарию: `plan` задаёт действия нужным игрокам, остальные делают «пустой» ход
 * (а чёрные воздерживаются). Ночь разрешается сама, когда сходят все.
 */
export async function playNight(
  table: Table,
  plan: (player: PlayerState) => NightAction[] | undefined = () => undefined,
  options: { skip?: string[] } = {},
): Promise<void> {
  const game = await table.game();
  for (const player of game.players) {
    if (!player.alive || options.skip?.includes(player.id)) continue;
    // кто уже сходил до вызова, повторно не ходит: иначе, окажись он последним по местам,
    // ночь разрешилась бы раньше его повторного хода
    if (nightMoveDone(game, player.id)) continue;
    const client = table.byId(player.id);
    const planned = plan(player);
    const actions: NightAction[] = planned ? [...planned] : [];
    if (!actions.some((a) => a.kind !== 'mafiaVote')) actions.push({ kind: 'pass' });
    if (player.team === 'black' && !actions.some((a) => a.kind === 'mafiaVote')) {
      actions.push({ kind: 'mafiaVote', target: null });
    }
    // голос мафии — последним: после него ход чёрного завершён, и ночь может разрешиться
    actions.sort((a, b) => Number(a.kind === 'mafiaVote') - Number(b.kind === 'mafiaVote'));
    for (const action of actions) await client.ok({ t: 'night', action });
  }
  await table.settle();
}

/**
 * Все онлайн-клиенты сообщают «готов». Если после этого начался день, хост сразу открывает
 * голосование (если не попросили остаться на обсуждении).
 */
export async function allReady(table: Table, options: { keepDiscussion?: boolean } = {}): Promise<void> {
  const state = await table.settle();
  for (const client of table.open) await client.request({ t: 'ready', step: state.step });
  await table.settle();
  if (!options.keepDiscussion) await startVoting(table);
}

/** Хост открывает голосование, если идёт обсуждение. */
export async function startVoting(table: Table): Promise<void> {
  const state = await table.settle();
  if (state.stage !== 'game' || !state.discussion || state.sync) return;
  const host = table.open.find((c) => c.memberId === state.hostId);
  if (!host) throw new Error('Хоста нет в сети: голосование открыть некому');
  await host.ok({ t: 'advance', step: state.step });
  await table.settle();
}
