import { describe, expect, it } from 'vitest';
import { viewFor } from '@mafia/engine';
import type { GameEvent, RoleId } from '@mafia/engine';
import type { HostMode, ServerMessage, SettingsPatch } from '@mafia/protocol';
import { seededRandom } from '../tools/bot';
import { Client, Table } from './harness';
import { allReady, playBots, playNight } from './play';
import { Wiretap } from './wiretap';

interface Scenario {
  name: string;
  players: number;
  seed: number;
  hostMode?: HostMode;
  settings?: SettingsPatch;
}

const SCENARIOS: Scenario[] = [
  { name: '7 игроков, настройки по умолчанию', players: 7, seed: 1 },
  {
    name: '10 игроков, роли и причины смерти не раскрываются',
    players: 10,
    seed: 2,
    settings: { rules: { revealRoleOnDeath: false, revealDeathCause: false, announceSaves: false } },
  },
  {
    name: '9 игроков, ведущий-наблюдатель, открытый состав, открытое голосование, мёртвые видят всё',
    players: 9,
    seed: 3,
    hostMode: 'narrator',
    settings: { display: 'open', rules: { votingMode: 'open', deadSeeAllRoles: true } },
  },
  {
    name: '12 игроков, режим «Кино», красная Любовница, казнь Шута заканчивает игру',
    players: 12,
    seed: 4,
    settings: { display: 'cinema', rules: { mistressMode: 'red', jesterWinEndsGame: true, votingMode: 'revealAfter' } },
  },
  {
    name: '8 игроков, много нейтральных и особых ролей',
    players: 8,
    seed: 5,
    settings: { composition: { quotas: { neutral: { exact: 2 }, black: { exact: 2 } }, minCiviliansShare: 0 } },
  },
  { name: '5 игроков, ручной состав', players: 5, seed: 6, settings: { composition: { preset: ['don', 'hunter', 'witch', 'bomber', 'civilian'] } } },
];

/** Стол на `players` участников партии (в режиме ведущего хост сидит сверх этого числа). */
function seat(scenario: Scenario): Promise<Table> {
  const others = scenario.hostMode === 'narrator' ? scenario.players : scenario.players - 1;
  return Table.create(others, { hostMode: scenario.hostMode, settings: scenario.settings });
}

describe('Полная партия ботов с прослушкой всех сообщений', () => {
  it.each(SCENARIOS)('$name', async (scenario) => {
    const table = await seat(scenario);
    const tap = new Wiretap(table);
    await tap.verify();
    await table.start();
    await tap.verify();

    const result = await playBots(table, { seed: scenario.seed, afterStep: () => tap.verify() });

    expect(tap.problems).toEqual([]);
    expect(tap.checked).toBeGreaterThan(scenario.players * 10);
    // ведущему разрешено видеть всё — и это тоже проверено; игрокам такие снимки не уходили
    if (scenario.hostMode === 'narrator') expect(tap.narratorMessages).toBeGreaterThan(20);
    else expect(tap.narratorMessages).toBe(0);
    // в «Кино» игроки получали личные сцены, и каждая проверена
    if (scenario.settings?.display === 'cinema') expect(tap.scenesChecked).toBeGreaterThan(3);
    else expect(tap.scenesChecked).toBe(0);
    // боты доиграли сами: ни разу не пришлось нажимать «дальше» за хоста
    expect(result.forced).toBe(0);
    expect(result.state.stage).toBe('finished');
    const game = result.state.game;
    expect(game?.phase).toBe('ended');
    expect(game?.players).toHaveLength(scenario.players);

    // каждый клиент дошёл до конца и видит один и тот же итог и все роли
    for (const client of table.clients) {
      expect(client.game?.stage).toBe('ended');
      expect(client.game?.view.result).toEqual(game?.result);
      expect(client.game?.view.players.map((p) => p.role)).toEqual(game?.players.map((p) => p.role));
      expect(client.events.at(-1)?.type).toBe('gameEnded');
      // номера событий у клиента идут по возрастанию, без повторов
      const ids = client.events.map((e) => e.id);
      expect(ids).toEqual([...new Set(ids)].sort((a, b) => a - b));
    }
    await table.closeAll();
  });

  it('с отключениями и переподключениями посреди партии', async () => {
    const table = await Table.create(8, { settings: { rules: { revealRoleOnDeath: false } } });
    const tap = new Wiretap(table);
    await table.start();
    await tap.verify();

    const random = seededRandom(77);
    let steps = 0;
    let away: { token: string; back: number } | null = null;
    let reconnects = 0;

    const result = await playBots(table, {
      seed: 7,
      afterStep: async () => {
        await tap.verify();
        steps++;
        if (away && steps >= away.back) {
          table.clients.push(await Client.resume(table.code, away.token));
          away = null;
          reconnects++;
          await tap.verify();
        } else if (!away && steps % 9 === 0) {
          // отключаем случайного игрока (не хоста — чтобы было кому нажать «дальше»)
          const candidates = table.open.filter((c) => c !== table.host);
          const victim = candidates[Math.floor(random() * candidates.length)] as Client;
          await victim.close();
          away = { token: victim.token as string, back: steps + 4 };
          await tap.verify();
        }
      },
    });

    expect(tap.problems).toEqual([]);
    expect(reconnects).toBeGreaterThan(2);
    expect(result.state.stage).toBe('finished');
    await table.closeAll();
  });

  it('несколько партий подряд в одной комнате', async () => {
    const table = await Table.create(5);
    const tap = new Wiretap(table);
    const seeds = new Set<string>();
    for (let round = 0; round < 3; round++) {
      await table.start();
      await tap.verify();
      const result = await playBots(table, { seed: 100 + round, afterStep: () => tap.verify() });
      expect(result.state.stage).toBe('finished');
      seeds.add(JSON.stringify(result.state.game?.players.map((p) => p.role)) + result.state.game?.rng);
      await table.host.ok({ t: 'toLobby' });
      await tap.verify();
      expect(table.clients.every((c) => c.game === null)).toBe(true);
    }
    expect(tap.problems).toEqual([]);
    // у каждой партии свой seed
    expect(seeds.size).toBe(3);
    await table.closeAll();
  });
});

describe('Прослушка действительно ловит утечки', () => {
  const SET: RoleId[] = ['mafia', 'mafia', 'doctor', 'commissioner', 'civilian', 'civilian', 'civilian'];

  /** Партия после первой ночи с событиями: есть что «слить». */
  async function setup(settings: SettingsPatch = {}) {
    const table = await Table.create(SET.length - 1, {
      settings: { rules: { revealRoleOnDeath: false }, ...settings, composition: { preset: SET } },
    });
    await table.start();
    const mafia = await table.seat('mafia');
    const civilian = await table.seat('civilian', 0);
    const victim = (await table.seat('civilian', 1)).player.id;
    await mafia.client.ok({ t: 'chat', text: 'секрет мафии' });
    await playNight(table, (p) => {
      if (p.role === 'mafia') return [{ kind: 'mafiaVote', target: victim }];
      if (p.role === 'commissioner') return [{ kind: 'ability', ability: 'check', targets: [mafia.player.id] }];
      return undefined;
    });
    await allReady(table);
    const state = await table.settle();
    // жертва для проверок — мирный, который не хост (хост знает ручной состав)
    const spy = civilian.client === table.host ? (await table.seat('civilian', 2)).client : civilian.client;
    const last = [...spy.inbox].reverse().find((m): m is Extract<ServerMessage, { t: 'game' }> => m.t === 'game');
    if (!last || !state.game) throw new Error('нет сообщения для подделки');
    return { table, state, game: state.game, spy, mafia, last };
  }

  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  /** Сколько проблем находит прослушка в (возможно, подделанном) сообщении. */
  function problemsIn(ctx: Awaited<ReturnType<typeof setup>>, client: Client, message: ServerMessage): string[] {
    const tap = new Wiretap(ctx.table);
    tap.inspect(ctx.state, client, message, JSON.stringify(message));
    return tap.problems;
  }

  it('настоящие сообщения проходят проверку', async () => {
    const ctx = await setup();
    const tap = new Wiretap(ctx.table);
    await tap.verify();
    expect(tap.problems).toEqual([]);
    expect(problemsIn(ctx, ctx.spy, ctx.last)).toEqual([]);
    await ctx.table.closeAll();
  });

  it('чужая роль в списке игроков', async () => {
    const ctx = await setup();
    const leaked = copy(ctx.last);
    const target = leaked.game.view.players.find((p) => p.id === ctx.mafia.player.id);
    if (!target) throw new Error('нет игрока');
    target.role = 'mafia';
    target.team = 'black';
    const problems = problemsIn(ctx, ctx.spy, leaked);
    expect(problems.some((p) => p.includes(`видна роль игрока ${ctx.mafia.player.id}`))).toBe(true);
    expect(problems.some((p) => p.includes('скрытая роль «mafia»'))).toBe(true);
    expect(problems.some((p) => p.includes('отличается от viewFor'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('полное событие вместо скрытного и событие, которое получателю не положено', async () => {
    const ctx = await setup();
    const full = (event: GameEvent) => ({
      id: event.id,
      round: event.round,
      phase: event.phase,
      type: event.type,
      actors: event.actors,
      targets: event.targets,
      data: event.data,
      redacted: false,
    });
    // смерть: мирному положен скрытный вид без убийцы
    const death = ctx.game.log.find((e) => e.type === 'death') as GameEvent;
    const withKiller = copy(ctx.last);
    withKiller.events = [full(death) as never];
    expect(problemsIn(ctx, ctx.spy, withKiller).some((p) => p.includes('отличается от проекции движка'))).toBe(true);

    // результат проверки Комиссара мирному не положен вовсе
    const checked = ctx.game.log.find((e) => e.type === 'checked') as GameEvent;
    const withCheck = copy(ctx.last);
    withCheck.events = [full(checked) as never];
    expect(problemsIn(ctx, ctx.spy, withCheck).some((p) => p.includes('отличается от проекции движка'))).toBe(true);

    // роль, названная в событии, ловится и поиском по тексту
    const assigned = ctx.game.log.find((e) => e.type === 'roleAssigned' && e.targets[0] === ctx.mafia.player.id) as GameEvent;
    const withRole = copy(ctx.last);
    withRole.events = [full(assigned) as never];
    expect(problemsIn(ctx, ctx.spy, withRole).some((p) => p.includes('скрытая роль «mafia»'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('снимок, предназначенный другому игроку', async () => {
    const ctx = await setup();
    const foreign = [...ctx.mafia.client.inbox].reverse().find((m) => m.t === 'game') as ServerMessage;
    const problems = problemsIn(ctx, ctx.spy, foreign);
    expect(problems.some((p) => p.includes('предназначен другому зрителю'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('чат мафии, пришедший мирному', async () => {
    const ctx = await setup();
    const chat = ctx.mafia.client.inbox.find((m) => m.t === 'chat') as ServerMessage;
    expect(problemsIn(ctx, ctx.mafia.client, chat)).toEqual([]);
    expect(problemsIn(ctx, ctx.spy, chat)).toEqual([`${ctx.spy.memberId} (chat): чат мафии получил не живой чёрный`]);
    await ctx.table.closeAll();
  });

  it('чужой токен и служебные поля', async () => {
    const ctx = await setup();
    const withToken = copy(ctx.last) as ServerMessage & { debug?: string };
    withToken.debug = ctx.mafia.client.token as string;
    expect(problemsIn(ctx, ctx.spy, withToken).some((p) => p.includes('чужой токен'))).toBe(true);

    const withState = copy(ctx.last) as ServerMessage & { debug?: unknown };
    withState.debug = { rng: ctx.game.rng };
    expect(problemsIn(ctx, ctx.spy, withState).some((p) => p.includes('служебное поле "rng"'))).toBe(true);

    const withVisibility = copy(ctx.last);
    withVisibility.events = [ctx.game.log[0] as never];
    expect(problemsIn(ctx, ctx.spy, withVisibility).some((p) => p.includes('служебное поле "visibility"'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('состав партии и сцены в скрытном режиме, ручной состав в настройках', async () => {
    const ctx = await setup();
    const withComposition = copy(ctx.last);
    withComposition.game.composition = [{ role: 'mafia', count: 2 }];
    expect(problemsIn(ctx, ctx.spy, withComposition).some((p) => p.includes('состав партии показан не по режиму'))).toBe(true);

    const withScenes = copy(ctx.last);
    withScenes.scenes = [{ id: 9, round: 1, ability: 'check', role: 'commissioner', saved: false }];
    expect(problemsIn(ctx, ctx.spy, withScenes).some((p) => p.includes('сцены вне режима «Кино»'))).toBe(true);

    // настройки с ручным составом, показанные не хосту
    const hostRoom = [...ctx.table.host.inbox].reverse().find((m) => m.t === 'room') as ServerMessage;
    expect(problemsIn(ctx, ctx.table.host, hostRoom)).toEqual([]);
    expect(problemsIn(ctx, ctx.spy, hostRoom).some((p) => p.includes('скрытая роль'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('в режиме «Кино»: чужая сцена, сцена с игроком и сцена с нападавшим', async () => {
    const ctx = await setup({ display: 'cinema' });
    // настоящая сцена: мафию проверял Комиссар — её получил только сам мафиози
    const real = ctx.mafia.client.scenes[0];
    if (!real) throw new Error('у мафии нет сцены');
    expect(real).toMatchObject({ ability: 'check', role: 'commissioner' });
    const own = [...ctx.mafia.client.inbox].reverse().find((m) => m.t === 'game' && m.scenes.length > 0) as ServerMessage;
    expect(problemsIn(ctx, ctx.mafia.client, own)).toEqual([]);

    // та же сцена, пришедшая постороннему
    const foreign = copy(ctx.last);
    foreign.scenes = [real];
    expect(problemsIn(ctx, ctx.spy, foreign).some((p) => p.includes('не положена получателю'))).toBe(true);

    // сцена, в которой назван игрок
    const withPlayer = copy(own) as Extract<ServerMessage, { t: 'game' }>;
    withPlayer.scenes = [{ ...real, actor: 'm1' } as never];
    expect(problemsIn(ctx, ctx.mafia.client, withPlayer).some((p) => p.includes('в сцене лишние поля'))).toBe(true);

    // сцена, раскрывающая нападавшего
    const withKiller = copy(ctx.last);
    withKiller.scenes = [{ id: real.id, round: 1, ability: 'kill', role: 'maniac', saved: false }];
    expect(problemsIn(ctx, ctx.spy, withKiller).some((p) => p.includes('раскрывает нападавшего'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('«закулисье» и снимок ведущего, пришедшие игроку', async () => {
    const ctx = await setup();
    const withBackstage = copy(ctx.last);
    withBackstage.game.view.backstage = { nightMoves: {}, votes: {}, decision: null, lovers: [] };
    const problems = problemsIn(ctx, ctx.spy, withBackstage);
    expect(problems.some((p) => p.includes('игроку показано закулисье'))).toBe(true);
    expect(problems.some((p) => p.includes('отличается от viewFor'))).toBe(true);

    // снимок «видит всё», собранный движком для ведущего, но отправленный игроку
    const omniscient = copy(ctx.last);
    const { events: _events, ...view } = viewFor(ctx.game, null, { seeAll: true });
    omniscient.game.view = view;
    const leaked = problemsIn(ctx, ctx.spy, omniscient);
    expect(leaked.some((p) => p.includes('предназначен другому зрителю'))).toBe(true);
    expect(leaked.some((p) => p.includes('видна роль игрока'))).toBe(true);
    expect(leaked.some((p) => p.includes('игроку показано закулисье'))).toBe(true);
    await ctx.table.closeAll();
  });

  it('в партии без ведущего «видеть всё» не положено никому, даже неиграющему', async () => {
    // обычная партия: хост играет. Подделываем сообщение так, будто получатель — наблюдатель
    const ctx = await setup();
    const fake = copy(ctx.last);
    const { events: _events, ...view } = viewFor(ctx.game, ctx.spy.memberId, { seeAll: true });
    fake.game.view = view;
    expect(problemsIn(ctx, ctx.spy, fake).length).toBeGreaterThan(0);
    await ctx.table.closeAll();
  });
});
