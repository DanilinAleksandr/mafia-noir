import { describe, expect, it } from 'vitest';
import type { RoleId } from '@mafia/engine';
import type { GameSnapshot, ServerMessage, SettingsPatch } from '@mafia/protocol';
import { Client, Table, hibernate, http } from './harness';
import { allReady, playNight } from './play';

/** Стол с заданным составом (роли раздаются случайно, тест узнаёт их из состояния комнаты). */
function tableWith(preset: RoleId[], settings: SettingsPatch = {}): Promise<Table> {
  return Table.create(preset.length - 1, {
    settings: { ...settings, composition: { ...(settings.composition ?? {}), preset } },
  });
}

const CLASSIC: RoleId[] = ['mafia', 'doctor', 'civilian', 'civilian', 'civilian'];

/** Срок стадии отсчитан от момента её начала (с допуском на миллисекунды между расчётом и отправкой). */
function expectDeadline(game: GameSnapshot | null | undefined, ms: number): void {
  const left = (game?.deadline ?? 0) - (game?.serverTime ?? 0);
  expect(left).toBeGreaterThan(ms - 500);
  expect(left).toBeLessThanOrEqual(ms);
}

/** Сообщения `game`, полученные клиентом начиная с позиции `from`. */
function gameMessages(client: Client, from = 0): Extract<ServerMessage, { t: 'game' }>[] {
  return client.inbox.slice(from).filter((m): m is Extract<ServerMessage, { t: 'game' }> => m.t === 'game');
}

describe('Ночь', () => {
  it('ждёт хода от всех живых, включая «пустой» ход тех, кому делать нечего', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const mafia = await table.seat('mafia');
    const doctor = await table.seat('doctor');
    const civilians = [await table.seat('civilian', 0), await table.seat('civilian', 1), await table.seat('civilian', 2)];
    const victim = civilians[0]!.player.id;
    expect(table.host.game).toMatchObject({ stage: 'night', progress: { done: 0, total: 5 }, deadline: null });

    await mafia.client.ok({ t: 'night', action: { kind: 'mafiaVote', target: victim } });
    await doctor.client.ok({ t: 'night', action: { kind: 'ability', ability: 'heal', targets: [civilians[1]!.player.id] } });
    await table.settle();
    // все, у кого есть ночное действие, уже сходили — но ночь не кончается: иначе по времени видно, кто мирный
    expect(table.host.game).toMatchObject({ stage: 'night', progress: { done: 2, total: 5 } });

    await civilians[0]!.client.ok({ t: 'night', action: { kind: 'pass' } });
    await civilians[1]!.client.ok({ t: 'night', action: { kind: 'pass' } });
    await table.settle();
    expect(table.host.game).toMatchObject({ stage: 'night', progress: { done: 4, total: 5 } });

    await civilians[2]!.client.ok({ t: 'night', action: { kind: 'pass' } });
    await table.settle();
    expect(table.host.game?.stage).toBe('morning');
    expect((await table.game()).players.find((p) => p.id === victim)?.alive).toBe(false);
    await table.closeAll();
  });

  it('мирному во время ночи приходит только счётчик ходов — без имён и действий', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const mafia = await table.seat('mafia');
    const civilian = await table.seat('civilian');
    const mark = civilian.client.inbox.length;
    const before = civilian.client.game;
    await mafia.client.ok({ t: 'night', action: { kind: 'mafiaVote', target: civilian.player.id } });
    await table.settle();

    const received = gameMessages(civilian.client, mark);
    expect(received).toHaveLength(1);
    expect(received[0]?.events).toEqual([]);
    expect(received[0]?.game.progress).toEqual({ done: 1, total: 5 });
    // кроме счётчика, номера рассылки и времени, в снимке ничего не изменилось
    const strip = (g: typeof before) => ({ ...g, rev: 0, serverTime: 0, progress: null });
    expect(strip(received[0]?.game ?? null)).toEqual(strip(before));
    expect(civilian.client.game?.view.night).toEqual({
      options: { abilities: [], mafiaVote: null },
      submitted: {},
      ready: true,
      teamVotes: null,
    });
    await table.closeAll();
  });

  it('заканчивается по таймеру, если он включён', async () => {
    const table = await tableWith(CLASSIC, { timers: { night: 30 } });
    await table.start();
    const game = table.host.game;
    expectDeadline(game, 30_000);
    await table.tick(29_000);
    expect(table.host.game?.stage).toBe('night');
    await table.tick(2_000);
    expect(table.host.game?.stage).toBe('morning');
    expect((await table.game()).players.every((p) => p.alive)).toBe(true);
    await table.closeAll();
  });

  it('заканчивается по кнопке хоста; чужая и устаревшая кнопка отклоняются', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const step = table.host.game?.step ?? -1;
    const guest = table.clients[1] as Client;
    expect(await guest.request({ t: 'advance', step })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(await table.host.request({ t: 'advance', step: step - 1 })).toMatchObject({ ok: false, code: 'STALE' });
    await table.host.ok({ t: 'advance', step });
    await table.settle();
    expect(table.host.game?.stage).toBe('morning');
    expect(table.host.game?.step).toBe(step + 1);
    await table.closeAll();
  });

  it('отключившегося игрока ждут: без таймера ночь закончит только хост', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const gone = table.clients[4] as Client;
    await gone.close();
    await playNight(table, undefined, { skip: [gone.memberId] });
    expect(table.host.game).toMatchObject({ stage: 'night', progress: { done: 4, total: 5 } });
    await table.host.ok({ t: 'advance', step: table.host.game?.step ?? -1 });
    await table.settle();
    expect(table.host.game?.stage).toBe('morning');
    await table.closeAll();
  });

  it('ход можно изменить, пока ночь не разрешена', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const doctor = await table.seat('doctor');
    const [a, b] = [(await table.seat('civilian', 0)).player.id, (await table.seat('civilian', 1)).player.id];
    await doctor.client.ok({ t: 'night', action: { kind: 'ability', ability: 'heal', targets: [a] } });
    await doctor.client.ok({ t: 'night', action: { kind: 'ability', ability: 'heal', targets: [b] } });
    await table.settle();
    expect(doctor.client.game?.view.night?.submitted).toEqual({ ability: { id: 'heal', targets: [b] } });
    expect(doctor.client.game?.progress).toEqual({ done: 1, total: 5 });
    // недопустимая цель — ошибка движка с русским текстом
    const reply = await doctor.client.request({ t: 'night', action: { kind: 'ability', ability: 'heal', targets: ['m99'] } });
    expect(reply).toMatchObject({ ok: false, code: 'GAME_INVALID_TARGET' });
    await table.closeAll();
  });
});

describe('Утро: синхронизация перед днём', () => {
  async function toMorning(settings: SettingsPatch = {}): Promise<Table> {
    const table = await tableWith(CLASSIC, settings);
    await table.start();
    await playNight(table);
    expect(table.host.game?.stage).toBe('morning');
    return table;
  }

  it('после ночи голоса не принимаются, пока клиенты не готовы', async () => {
    const table = await toMorning();
    const game = table.host.game;
    expectDeadline(game, 15_000);
    expect(game?.progress).toEqual({ done: 0, total: 5 });
    expect(game?.view.phase).toBe('day');
    expect(await table.host.request({ t: 'vote', target: 'm2' })).toMatchObject({ ok: false, code: 'WRONG_STAGE' });
    await table.closeAll();
  });

  it('день начинается, когда «готов» прислали все, кто в сети', async () => {
    const table = await toMorning();
    const step = table.host.game?.step ?? -1;
    for (const client of table.clients.slice(0, 4)) await client.ok({ t: 'ready', step });
    await table.settle();
    expect(table.host.game).toMatchObject({ stage: 'morning', progress: { done: 4, total: 5 } });
    // повторный и устаревший «готов» ничего не меняют
    await table.host.ok({ t: 'ready', step });
    await (table.clients[4] as Client).ok({ t: 'ready', step: step - 1 });
    await table.settle();
    expect(table.host.game?.progress).toEqual({ done: 4, total: 5 });

    await (table.clients[4] as Client).ok({ t: 'ready', step });
    await table.settle();
    expect(table.host.game).toMatchObject({ stage: 'day', step: step + 1, deadline: null });
    expect(await table.host.request({ t: 'vote', target: 'm2' })).toMatchObject({ ok: true });
    await table.closeAll();
  });

  it('по таймауту 15 секунд день начинается сам', async () => {
    const table = await toMorning();
    await table.host.ok({ t: 'ready', step: table.host.game?.step ?? -1 });
    await table.tick(14_000);
    expect(table.host.game?.stage).toBe('morning');
    await table.tick(1_500);
    expect(table.host.game?.stage).toBe('day');
    await table.closeAll();
  });

  it('хост может начать день, не дожидаясь остальных', async () => {
    const table = await toMorning();
    await table.host.ok({ t: 'advance', step: table.host.game?.step ?? -1 });
    await table.settle();
    expect(table.host.game?.stage).toBe('day');
    await table.closeAll();
  });

  it('отключившегося не ждут', async () => {
    const table = await toMorning();
    const step = table.host.game?.step ?? -1;
    for (const client of table.clients.slice(0, 4)) await client.ok({ t: 'ready', step });
    await (table.clients[4] as Client).close();
    await table.settle();
    expect(table.host.game?.stage).toBe('day');
    await table.closeAll();
  });

  it('с таймером дня отсчёт начинается с начала дня, а не с конца ночи', async () => {
    const table = await toMorning({ timers: { day: 60 } });
    await allReady(table);
    const game = table.host.game;
    expect(game?.stage).toBe('day');
    expectDeadline(game, 60_000);
    await table.closeAll();
  });
});

describe('День', () => {
  async function toDay(settings: SettingsPatch = {}): Promise<Table> {
    const table = await tableWith(CLASSIC, settings);
    await table.start();
    await playNight(table);
    await allReady(table);
    expect(table.host.game?.stage).toBe('day');
    return table;
  }

  it('когда проголосовали все живые, итог подводится сразу', async () => {
    const table = await toDay();
    const target = (await table.seat('civilian')).player.id;
    const voters = table.clients.filter((c) => c.memberId !== target);
    for (const voter of voters.slice(0, 3)) await voter.ok({ t: 'vote', target });
    await table.settle();
    expect(table.host.game).toMatchObject({ stage: 'day', progress: { done: 3, total: 5 } });
    expect(table.host.game?.view.day?.ballots).toBeNull();

    await (voters[3] as Client).ok({ t: 'vote', target });
    await table.byId(target).ok({ t: 'vote', target: null });
    await table.settle();
    // казнь состоялась; перед ночью — вечер: клиенты показывают приговор
    expect(table.host.game?.stage).toBe('evening');
    expect((await table.game()).players.find((p) => p.id === target)?.alive).toBe(false);
    await allReady(table);
    expect(table.host.game?.stage).toBe('night');
    expect(table.host.game?.view.round).toBe(2);
    // казнённый больше не ходит
    expect(await table.byId(target).request({ t: 'night', action: { kind: 'pass' } })).toMatchObject({
      ok: false,
      code: 'GAME_PLAYER_DEAD',
    });
    await table.closeAll();
  });

  it('по таймеру дня голосование подводится с тем, что есть', async () => {
    const table = await toDay({ timers: { day: 45 } });
    const target = (await table.seat('civilian')).player.id;
    await table.host.ok({ t: 'vote', target: table.host.memberId === target ? null : target });
    await table.tick(46_000);
    expect(table.host.game?.stage).toBe('evening');
    await table.closeAll();
  });

  it('хост может подвести итог досрочно', async () => {
    const table = await toDay();
    await table.host.ok({ t: 'advance', step: table.host.game?.step ?? -1 });
    await table.settle();
    expect(table.host.game?.stage).toBe('evening');
    expect(table.host.events.some((e) => e.type === 'noExecution')).toBe(true);
    await table.closeAll();
  });

  it('партия заканчивается: стадия «ended», всем открыты роли, комната «finished»', async () => {
    const table = await toDay();
    const mafia = (await table.seat('mafia')).player.id;
    for (const client of table.clients) await client.ok({ t: 'vote', target: client.memberId === mafia ? null : mafia });
    await table.settle();
    for (const client of table.clients) {
      expect(client.game?.stage).toBe('ended');
      expect(client.game?.view.result).toMatchObject({ outcome: 'red' });
      expect(client.game?.view.players.every((p) => p.role !== null)).toBe(true);
      expect(client.room?.stage).toBe('finished');
    }
    expect(await table.host.request({ t: 'advance', step: table.host.game?.step ?? -1 })).toMatchObject({
      ok: false,
      code: 'WRONG_STAGE',
    });
    expect(await (await http(`/api/rooms/${table.code}`)).json()).toMatchObject({ stage: 'finished', joinable: false });

    // хост возвращает всех в лобби и начинает заново
    await table.host.ok({ t: 'toLobby' });
    await table.settle();
    expect(table.clients.every((c) => c.game === null && c.room?.stage === 'lobby')).toBe(true);
    await table.start();
    expect(table.host.game).toMatchObject({ stage: 'night' });
    expect(table.host.game?.view.round).toBe(1);
    await table.closeAll();
  });
});

describe('Отложенные решения', () => {
  const HUNT: RoleId[] = ['hunter', 'mafia', 'civilian', 'civilian', 'civilian'];

  async function hunterKilled(settings: SettingsPatch = {}): Promise<Table> {
    const table = await tableWith(HUNT, { rules: { revealRoleOnDeath: false }, ...settings });
    await table.start();
    const hunter = (await table.seat('hunter')).player.id;
    await playNight(table, (p) => (p.role === 'mafia' ? [{ kind: 'mafiaVote', target: hunter }] : undefined));
    return table;
  }

  it('решение приходит только нужному игроку, остальные видят нейтральное ожидание', async () => {
    const table = await hunterKilled();
    const hunter = await table.seat('hunter');
    expect(hunter.client.game?.stage).toBe('decision');
    expect(hunter.client.game?.view.decision).toMatchObject({ kind: 'hunterShot', condemned: null });
    expect(hunter.client.game?.view.decision?.options).toHaveLength(4);

    for (const client of table.clients.filter((c) => c !== hunter.client)) {
      expect(client.game).toMatchObject({ stage: 'decision', progress: null });
      expect(client.game?.view.decision).toBeNull();
      expect(client.game?.view.waitingForDecision).toBe(true);
      // ни в одном сообщении этому клиенту нет ни вида решения, ни роли Охотника
      expect(client.raw.join('\n')).not.toContain('hunterShot');
      // хост сам задал состав и знает, что Охотник в игре; остальным роль не названа нигде
      if (client !== table.host) expect(client.raw.join('\n')).not.toContain('"hunter"');
      expect(await client.request({ t: 'decision', decision: { kind: 'hunterShot', target: null } })).toMatchObject({
        ok: false,
        code: 'GAME_NO_DECISION',
      });
    }
    // пока решение не принято, ни ночь, ни день не идут
    expect(await table.host.request({ t: 'vote', target: null })).toMatchObject({ ok: false, code: 'WRONG_STAGE' });

    await hunter.client.ok({ t: 'decision', decision: { kind: 'hunterShot', target: null } });
    await table.settle();
    expect(table.host.game?.stage).toBe('morning');
    await table.closeAll();
  });

  it('выстрел Охотника в мафию заканчивает партию', async () => {
    const table = await hunterKilled();
    const hunter = await table.seat('hunter');
    const mafia = (await table.seat('mafia')).player.id;
    await hunter.client.ok({ t: 'decision', decision: { kind: 'hunterShot', target: mafia } });
    await table.settle();
    expect(table.host.game?.stage).toBe('ended');
    expect(table.host.game?.view.result?.outcome).toBe('red');
    await table.closeAll();
  });

  it('по таймеру решения применяется решение по умолчанию', async () => {
    const table = await hunterKilled({ timers: { decision: 20 } });
    const game = table.host.game;
    expectDeadline(game, 20_000);
    await table.tick(21_000);
    expect(table.host.game?.stage).toBe('morning');
    expect((await table.game()).players.filter((p) => !p.alive)).toHaveLength(1);
    await table.closeAll();
  });

  it('хост может не ждать решения отключившегося', async () => {
    const table = await hunterKilled();
    const hunter = await table.seat('hunter');
    // чтобы сценарий не зависел от раздачи: если Охотник — сам хост, права передаются другому
    if (hunter.client === table.host) {
      await table.host.ok({ t: 'transferHost', memberId: (table.clients[1] as Client).memberId });
    }
    await hunter.client.close();
    const state = await table.settle();
    const host = table.byId(state.hostId);
    await host.ok({ t: 'advance', step: host.game?.step ?? -1 });
    await table.settle();
    expect(host.game?.stage).toBe('morning');
    await table.closeAll();
  });

  it('Судья видит приговорённого и может отменить казнь', async () => {
    const table = await tableWith(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    await table.start();
    await playNight(table);
    await allReady(table);
    const judge = await table.seat('judge');
    const target = (await table.seat('civilian')).player.id;
    for (const client of table.clients) await client.ok({ t: 'vote', target: client.memberId === target ? null : target });
    await table.settle();
    expect(judge.client.game?.view.decision).toEqual({ kind: 'judgeVeto', options: [], condemned: target });
    const other = table.clients.find((c) => c !== judge.client) as Client;
    expect(other.game).toMatchObject({ stage: 'decision' });
    expect(other.game?.view.decision).toBeNull();

    await judge.client.ok({ t: 'decision', decision: { kind: 'judgeVeto', veto: true } });
    await table.settle();
    expect(table.host.game?.stage).toBe('evening');
    expect((await table.game()).players.every((p) => p.alive)).toBe(true);
    await table.closeAll();
  });
});

describe('Чат мафии', () => {
  const TWO_MAFIA: RoleId[] = ['mafia', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian'];

  it('ночью его видят только живые чёрные', async () => {
    const table = await tableWith(TWO_MAFIA);
    await table.start();
    const first = await table.seat('mafia', 0);
    const second = await table.seat('mafia', 1);
    const civilian = await table.seat('civilian');

    await first.client.ok({ t: 'chat', text: '  бьём третьего  ' });
    await second.client.until(() => second.client.chat.length === 1);
    expect(second.client.chat[0]).toMatchObject({ id: 1, from: first.player.id, text: 'бьём третьего', round: 1 });
    expect(first.client.chat).toHaveLength(1);
    await second.client.ok({ t: 'chat', text: 'согласен' });
    await first.client.until(() => first.client.chat.length === 2);

    // мирные не получают и не могут писать
    await table.settle();
    for (const client of table.clients.filter((c) => c !== first.client && c !== second.client)) {
      expect(client.chat).toEqual([]);
      expect(client.inbox.some((m) => m.t === 'chat')).toBe(false);
      expect(client.raw.join('\n')).not.toContain('бьём третьего');
    }
    expect(await civilian.client.request({ t: 'chat', text: 'я тоже мафия' })).toMatchObject({
      ok: false,
      code: 'CHAT_FORBIDDEN',
    });
    await table.closeAll();
  });

  it('историю при переподключении получает мафия, но не мирный', async () => {
    const table = await tableWith(TWO_MAFIA);
    await table.start();
    const first = await table.seat('mafia', 0);
    const second = await table.seat('mafia', 1);
    const civilian = await table.seat('civilian');
    await first.client.ok({ t: 'chat', text: 'привет' });

    await second.client.close();
    const mafiaAgain = await Client.resume(table.code, second.client.token as string);
    expect(mafiaAgain.chat.map((m) => m.text)).toEqual(['привет']);
    await civilian.client.close();
    const civilianAgain = await Client.resume(table.code, civilian.client.token as string);
    expect(civilianAgain.chat).toEqual([]);
    expect(civilianAgain.raw.join('\n')).not.toContain('привет');
    table.clients.push(mafiaAgain, civilianAgain);
    await table.closeAll();
  });

  it('утром и днём чат закрыт; пустые и слишком длинные сообщения отклоняются', async () => {
    const table = await tableWith(TWO_MAFIA);
    await table.start();
    const mafia = await table.seat('mafia');
    mafia.client.sendRaw(JSON.stringify({ t: 'chat', id: 900, text: '   ' }));
    await mafia.client.until(() => mafia.client.lastError()?.re === 900);
    expect(mafia.client.lastError()?.code).toBe('BAD_MESSAGE');
    mafia.client.sendRaw(JSON.stringify({ t: 'chat', id: 901, text: 'я'.repeat(301) }));
    await mafia.client.until(() => mafia.client.lastError()?.re === 901);
    expect(mafia.client.lastError()?.code).toBe('BAD_MESSAGE');

    await playNight(table);
    expect(await mafia.client.request({ t: 'chat', text: 'утро' })).toMatchObject({ ok: false, code: 'CHAT_FORBIDDEN' });
    await allReady(table);
    expect(await mafia.client.request({ t: 'chat', text: 'день' })).toMatchObject({ ok: false, code: 'CHAT_FORBIDDEN' });
    await table.closeAll();
  });

  it('погибший мафиози выпадает из чата', async () => {
    const table = await tableWith(TWO_MAFIA);
    await table.start();
    const dead = await table.seat('mafia', 0);
    const alive = await table.seat('mafia', 1);
    await dead.client.ok({ t: 'chat', text: 'пока жив' });
    await playNight(table);
    await allReady(table);
    for (const client of table.clients) {
      await client.ok({ t: 'vote', target: client === dead.client ? null : dead.player.id });
    }
    await allReady(table);
    expect(table.host.game?.stage).toBe('night');

    const mark = dead.client.inbox.length;
    await alive.client.ok({ t: 'chat', text: 'остался один' });
    await table.settle();
    expect(alive.client.chat.map((m) => m.text)).toEqual(['пока жив', 'остался один']);
    expect(dead.client.inbox.slice(mark).some((m) => m.t === 'chat')).toBe(false);
    expect(await dead.client.request({ t: 'chat', text: 'я с вами' })).toMatchObject({ ok: false, code: 'CHAT_FORBIDDEN' });
    // и при переподключении истории ему не будет
    await dead.client.close();
    const again = await Client.resume(table.code, dead.client.token as string);
    expect(again.chat).toEqual([]);
    table.clients.push(again);
    await table.closeAll();
  });
});

describe('Режимы показа событий', () => {
  const SET: RoleId[] = ['mafia', 'doctor', 'commissioner', 'civilian', 'civilian'];

  /** Ночь: мафия бьёт мирного, Доктор его лечит, Комиссар проверяет мафию. */
  async function eventfulNight(table: Table): Promise<void> {
    const mafia = (await table.seat('mafia')).player.id;
    const victim = (await table.seat('civilian')).player.id;
    await playNight(table, (p) => {
      if (p.role === 'mafia') return [{ kind: 'mafiaVote', target: victim }];
      if (p.role === 'doctor') return [{ kind: 'ability', ability: 'heal', targets: [victim] }];
      if (p.role === 'commissioner') return [{ kind: 'ability', ability: 'check', targets: [mafia] }];
      return undefined;
    });
  }

  it('«Скрытный»: ни состава, ни сцен', async () => {
    const table = await tableWith(SET);
    await table.start();
    await eventfulNight(table);
    for (const client of table.clients) {
      expect(client.game?.display).toBe('stealth');
      expect(client.game?.composition).toBeNull();
      expect(client.scenes).toEqual([]);
    }
    await table.closeAll();
  });

  it('«Открытый состав»: всем виден список ролей без владельцев, в порядке каталога', async () => {
    const table = await tableWith(SET, { display: 'open' });
    await table.start();
    await eventfulNight(table);
    for (const client of table.clients) {
      expect(client.game?.composition).toEqual([
        { role: 'commissioner', count: 1 },
        { role: 'doctor', count: 1 },
        { role: 'civilian', count: 2 },
        { role: 'mafia', count: 1 },
      ]);
      expect(client.scenes).toEqual([]);
    }
    // владельцы по-прежнему скрыты
    const civilian = await table.seat('civilian', 1);
    expect(civilian.client.game?.view.players.filter((p) => p.role !== null)).toHaveLength(1);
    await table.closeAll();
  });

  it('«Кино»: игрок узнаёт роль того, кто на него подействовал, — и только он', async () => {
    const table = await tableWith(SET, { display: 'cinema' });
    await table.start();
    expect(table.clients.every((c) => c.scenes.length === 0)).toBe(true);
    const mafia = await table.seat('mafia');
    const victim = await table.seat('civilian', 0);
    await eventfulNight(table);

    // мирного лечил Доктор — и это его спасло; мафию проверял Комиссар
    expect(victim.client.scenes).toMatchObject([{ round: 1, ability: 'heal', role: 'doctor', saved: true }]);
    expect(mafia.client.scenes).toMatchObject([{ round: 1, ability: 'check', role: 'commissioner', saved: false }]);
    // остальным сцен не приходит: на них никто не действовал
    for (const client of table.clients) {
      if (client !== victim.client && client !== mafia.client) expect(client.scenes).toEqual([]);
      expect(client.game?.composition).toHaveLength(4);
    }
    // в сцене есть роль, но нет игрока; результат проверки по-прежнему знает только Комиссар
    expect(Object.keys(victim.client.scenes[0] ?? {}).sort()).toEqual(['ability', 'id', 'role', 'round', 'saved']);
    expect(JSON.stringify(mafia.client.scenes)).not.toContain((await table.seat('commissioner')).player.id);
    expect(mafia.client.events.some((e) => e.type === 'checked')).toBe(false);
    // кто нападал, спасённый не узнаёт
    expect(JSON.stringify(victim.client.scenes)).not.toContain('mafia');
    expect(victim.client.game?.view.players.filter((p) => p.role !== null)).toHaveLength(1);

    // переподключившийся получает свои сцены заново
    await victim.client.close();
    const again = await Client.resume(table.code, victim.client.token as string);
    expect(again.scenes).toEqual(victim.client.scenes);
    table.clients.push(again);
    await table.closeAll();
  });

  it('«Кино»: убийца не раскрывается, наблюдение Патрульного сценой не становится', async () => {
    const table = await tableWith(['mafia', 'mistress', 'hobo', 'bodyguard', 'maniac', 'patrol', 'civilian', 'civilian'], {
      display: 'cinema',
    });
    await table.start();
    const a = await table.seat('civilian', 0);
    const b = await table.seat('civilian', 1);
    await playNight(table, (p) => {
      if (p.role === 'mistress') return [{ kind: 'ability', ability: 'block', targets: [a.player.id] }];
      if (p.role === 'hobo') return [{ kind: 'ability', ability: 'stay', targets: [a.player.id] }];
      if (p.role === 'patrol') return [{ kind: 'ability', ability: 'watch', targets: [a.player.id] }];
      if (p.role === 'bodyguard') return [{ kind: 'ability', ability: 'guard', targets: [b.player.id] }];
      if (p.role === 'maniac') return [{ kind: 'ability', ability: 'kill', targets: [b.player.id] }];
      return undefined;
    });
    const brief = (client: Client) =>
      client.scenes.map((s) => `${s.role}:${s.ability}:${s.saved}`).sort();
    // у первого мирного ночевал Бомж и его заблокировала Любовница; Патрульный следил издалека — не сцена
    expect(brief(a.client)).toEqual(['hobo:stay:false', 'mistress:block:false']);
    // второго закрыл собой Телохранитель; кто напал — не сказано
    expect(brief(b.client)).toEqual(['bodyguard:guard:true']);
    expect((await table.game()).players.find((p) => p.role === 'bodyguard')?.alive).toBe(false);

    for (const client of table.clients) {
      // ни в одной сцене нет нападения
      expect(client.scenes.some((s) => s.ability === 'kill' || s.ability === 'potionKill')).toBe(false);
      // убийцу в событии «смерть» видит только сам убийца
      const maniac = (await table.seat('maniac')).client;
      for (const event of client.events) {
        if (event.type === 'death' && event.actors.length > 0) expect(client).toBe(maniac);
      }
    }
    await table.closeAll();
  });
});

describe('Вечер: синхронизация после приговора', () => {
  /** До вечера первого дня: казнён мирный. */
  async function toEvening(settings: SettingsPatch = {}): Promise<Table> {
    const table = await tableWith(CLASSIC, settings);
    await table.start();
    await playNight(table);
    await allReady(table);
    const target = (await table.seat('civilian')).player.id;
    for (const client of table.clients) await client.ok({ t: 'vote', target: client.memberId === target ? null : target });
    await table.settle();
    expect(table.host.game?.stage).toBe('evening');
    return table;
  }

  it('после казни ночь не начинается, пока клиенты не готовы', async () => {
    const table = await toEvening();
    const game = table.host.game;
    expectDeadline(game, 15_000);
    expect(game?.progress).toEqual({ done: 0, total: 5 });
    // движок уже в ночи второго круга, но ходы сервер не принимает
    expect(game?.view.phase).toBe('night');
    expect(game?.view.round).toBe(2);
    const mafia = await table.seat('mafia');
    expect(await mafia.client.request({ t: 'night', action: { kind: 'mafiaVote', target: null } })).toMatchObject({
      ok: false,
      code: 'WRONG_STAGE',
    });
    expect(await mafia.client.request({ t: 'chat', text: 'рано' })).toMatchObject({ ok: false, code: 'CHAT_FORBIDDEN' });
    // событие казни уже у всех: его и показывает сцена приговора
    expect(table.host.events.some((e) => e.type === 'death' && e.data.cause === 'execution')).toBe(true);
    await table.closeAll();
  });

  it('ночь начинается, когда «готов» прислали все, кто в сети', async () => {
    const table = await toEvening();
    const step = table.host.game?.step ?? -1;
    for (const client of table.clients.slice(0, 4)) await client.ok({ t: 'ready', step });
    await table.settle();
    expect(table.host.game).toMatchObject({ stage: 'evening', progress: { done: 4, total: 5 } });
    await (table.clients[4] as Client).ok({ t: 'ready', step });
    await table.settle();
    expect(table.host.game).toMatchObject({ stage: 'night', step: step + 1, deadline: null });
    expect(table.host.game?.progress).toEqual({ done: 0, total: 4 });
    await table.closeAll();
  });

  it('по таймауту 15 секунд ночь начинается сама', async () => {
    const table = await toEvening();
    await table.tick(14_000);
    expect(table.host.game?.stage).toBe('evening');
    await table.tick(1_500);
    expect(table.host.game?.stage).toBe('night');
    await table.closeAll();
  });

  it('хост может начать ночь, не дожидаясь остальных; отключившегося не ждут', async () => {
    const byHost = await toEvening();
    await byHost.host.ok({ t: 'advance', step: byHost.host.game?.step ?? -1 });
    await byHost.settle();
    expect(byHost.host.game?.stage).toBe('night');
    await byHost.closeAll();

    const table = await toEvening();
    const step = table.host.game?.step ?? -1;
    for (const client of table.clients.slice(0, 4)) await client.ok({ t: 'ready', step });
    await (table.clients[4] as Client).close();
    await table.settle();
    expect(table.host.game?.stage).toBe('night');
    await table.closeAll();
  });

  it('таймер ночи отсчитывается с начала ночи, а не с казни', async () => {
    const table = await toEvening({ timers: { night: 40 } });
    await allReady(table);
    expect(table.host.game?.stage).toBe('night');
    expectDeadline(table.host.game, 40_000);
    await table.closeAll();
  });

  it('вечер наступает и когда никого не казнили', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    await playNight(table);
    await allReady(table);
    for (const client of table.clients) await client.ok({ t: 'vote', target: null });
    await table.settle();
    expect(table.host.game?.stage).toBe('evening');
    expect(table.host.events.some((e) => e.type === 'noExecution')).toBe(true);
    await table.closeAll();
  });

  it('предсмертный выстрел казнённого Охотника — до вечера', async () => {
    const table = await tableWith(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    await table.start();
    await playNight(table);
    await allReady(table);
    const hunter = await table.seat('hunter');
    for (const client of table.clients) {
      await client.ok({ t: 'vote', target: client === hunter.client ? null : hunter.player.id });
    }
    await table.settle();
    expect(table.host.game?.stage).toBe('decision');
    const target = (await table.seat('civilian')).player.id;
    await hunter.client.ok({ t: 'decision', decision: { kind: 'hunterShot', target } });
    await table.settle();
    expect(table.host.game?.stage).toBe('evening');
    expect((await table.game()).players.filter((p) => !p.alive)).toHaveLength(2);
    await table.closeAll();
  });

  it('если казнь заканчивает партию, вечера нет', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    await playNight(table);
    await allReady(table);
    const mafia = (await table.seat('mafia')).player.id;
    for (const client of table.clients) await client.ok({ t: 'vote', target: client.memberId === mafia ? null : mafia });
    await table.settle();
    expect(table.host.game?.stage).toBe('ended');
    expect((await table.state()).sync).toBeNull();
    await table.closeAll();
  });
});

describe('Ведущий-наблюдатель видит всё', () => {
  const SET: RoleId[] = ['mafia', 'mafia', 'doctor', 'commissioner', 'hunter', 'civilian'];

  /** Хост-ведущий и шесть игроков. */
  async function narrated(settings: SettingsPatch = {}): Promise<Table> {
    const table = await Table.create(SET.length, {
      hostMode: 'narrator',
      settings: { ...settings, composition: { preset: SET } },
    });
    await table.start();
    return table;
  }

  it('с самого начала видит все роли и раздачу', async () => {
    const table = await narrated();
    const view = table.host.game?.view;
    expect(view?.viewer).toBeNull();
    expect(view?.you).toBeNull();
    expect([...(view?.players.map((p) => p.role) ?? [])].sort()).toEqual([...SET].sort());
    expect(table.host.events.filter((e) => e.type === 'roleAssigned')).toHaveLength(6);
    expect(table.host.events.every((e) => !e.redacted)).toBe(true);
    expect(view?.backstage).toEqual({ nightMoves: {}, votes: {}, decision: null, lovers: [] });
    await table.closeAll();
  });

  it('видит ночные ходы в реальном времени, а после ночи — все результаты', async () => {
    const table = await narrated();
    const mafia = await table.seat('mafia');
    const commissioner = await table.seat('commissioner');
    const victim = (await table.seat('civilian')).player.id;

    await mafia.client.ok({ t: 'night', action: { kind: 'mafiaVote', target: victim } });
    await commissioner.client.ok({ t: 'night', action: { kind: 'ability', ability: 'check', targets: [mafia.player.id] } });
    await table.settle();
    expect(table.host.game?.view.backstage?.nightMoves).toEqual({
      [mafia.player.id]: { mafiaVote: victim },
      [commissioner.player.id]: { ability: { id: 'check', targets: [mafia.player.id] } },
    });
    // игроки чужих ходов не видят
    for (const client of table.clients.slice(1)) expect(client.game?.view.backstage).toBeNull();

    await playNight(table, (p) => {
      if (p.id === mafia.player.id) return [{ kind: 'mafiaVote', target: victim }];
      if (p.role === 'commissioner') return [{ kind: 'ability', ability: 'check', targets: [mafia.player.id] }];
      return undefined;
    });
    const events = table.host.events;
    expect(events.find((e) => e.type === 'checked')).toMatchObject({
      actors: [commissioner.player.id],
      targets: [mafia.player.id],
      data: { isMafia: true },
      redacted: false,
    });
    expect(events.find((e) => e.type === 'death')).toMatchObject({ targets: [victim], redacted: false });
    expect(events.find((e) => e.type === 'death')?.actors).toHaveLength(1);
    expect(events.some((e) => e.type === 'mafiaTargetChosen')).toBe(true);
    expect(events.some((e) => e.type === 'abilityUsed')).toBe(true);
    await table.closeAll();
  });

  it('видит голоса в тайном голосовании и знает, чьего решения ждёт игра', async () => {
    const table = await narrated();
    const hunter = await table.seat('hunter');
    await playNight(table, (p) => (p.role === 'mafia' ? [{ kind: 'mafiaVote', target: hunter.player.id }] : undefined));
    expect(table.host.game?.stage).toBe('decision');
    expect(table.host.game?.view.backstage?.decision).toMatchObject({ kind: 'hunterShot', playerId: hunter.player.id });
    // самому ведущему решать нечего
    expect(table.host.game?.view.decision).toBeNull();
    await hunter.client.ok({ t: 'decision', decision: { kind: 'hunterShot', target: null } });
    await allReady(table);

    const voter = (await table.seat('doctor')).client;
    const target = (await table.seat('civilian')).player.id;
    await voter.ok({ t: 'vote', target });
    await table.settle();
    expect(table.host.game?.view.backstage?.votes).toEqual({ [voter.memberId]: target });
    expect(voter.game?.view.day?.ballots).toBeNull();
    const other = (await table.seat('commissioner')).client;
    expect(other.game?.view.backstage).toBeNull();
    expect(JSON.stringify(other.game)).not.toContain(`"${voter.memberId}":"${target}"`);
    await table.closeAll();
  });

  it('читает чат мафии, но писать в него и ходить не может', async () => {
    const table = await narrated();
    const mafia = await table.seat('mafia');
    await mafia.client.ok({ t: 'chat', text: 'ведущий нас слышит' });
    await table.host.until(() => table.host.chat.length === 1, 'чат у ведущего');
    expect(table.host.chat[0]?.text).toBe('ведущий нас слышит');
    expect(await table.host.request({ t: 'chat', text: 'привет' })).toMatchObject({ ok: false, code: 'CHAT_FORBIDDEN' });
    expect(await table.host.request({ t: 'night', action: { kind: 'pass' } })).toMatchObject({ ok: false, code: 'NOT_PLAYING' });
    expect(await table.host.request({ t: 'vote', target: null })).toMatchObject({ ok: false });

    // при переподключении ведущий получает всё заново
    const token = table.host.token as string;
    await table.host.close();
    const again = await Client.resume(table.code, token);
    expect(again.chat.map((m) => m.text)).toEqual(['ведущий нас слышит']);
    expect(again.events.filter((e) => e.type === 'roleAssigned')).toHaveLength(6);
    expect(again.game?.view.backstage).not.toBeNull();
    table.clients.push(again);
    await table.closeAll();
  });

  it('права хоста можно передать игроку — видеть всё он от этого не начинает', async () => {
    const table = await narrated();
    const player = table.clients[1] as Client;
    await table.host.ok({ t: 'transferHost', memberId: player.memberId });
    await playNight(table);
    expect(player.room?.hostId).toBe(player.memberId);
    expect(player.game?.view.backstage).toBeNull();
    expect(player.game?.view.players.filter((p) => p.role !== null).length).toBeLessThan(6);
    // прежний ведущий остаётся наблюдателем
    expect(table.host.game?.view.backstage).not.toBeNull();
    expect(table.host.game?.view.players.every((p) => p.role !== null)).toBe(true);
    await table.closeAll();
  });

  it('когда хост играет сам, «закулисья» нет ни у кого', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const mafia = await table.seat('mafia');
    const victim = (await table.seat('civilian')).player.id;
    await playNight(table, (p) => (p.role === 'mafia' ? [{ kind: 'mafiaVote', target: victim }] : undefined));
    for (const client of table.clients) {
      expect(client.game?.view.backstage).toBeNull();
      // выбор жертвы мафией видит только сама мафия
      expect(client.events.some((e) => e.type === 'mafiaTargetChosen')).toBe(client === mafia.client);
    }
    await table.closeAll();
  });
});

describe('Устойчивость', () => {
  it('объект может уснуть посреди партии: состояние и соединения сохраняются', async () => {
    const table = await tableWith(CLASSIC);
    await table.start();
    const mafia = await table.seat('mafia');
    const victim = (await table.seat('civilian')).player.id;
    await mafia.client.ok({ t: 'night', action: { kind: 'mafiaVote', target: victim } });
    const before = await table.state();

    await hibernate(table.code);
    // «ping» обслуживается без пробуждения объекта
    table.host.sendRaw('ping');
    await table.host.until(() => table.host.pongs === 1, 'pong');

    const after = await table.state();
    expect(after.game).toEqual(before.game);
    expect(after.members).toEqual(before.members);
    // все по-прежнему в сети и могут ходить; ночь доигрывается
    expect(table.host.closed).toBeNull();
    await playNight(table, (p) => (p.role === 'mafia' ? [{ kind: 'mafiaVote', target: victim }] : undefined));
    expect(table.host.game?.stage).toBe('morning');
    expect(table.host.room?.members.every((m) => m.online)).toBe(true);
    expect((await table.game()).players.find((p) => p.id === victim)?.alive).toBe(false);

    await hibernate(table.code);
    await allReady(table);
    expect(table.host.game?.stage).toBe('day');
    await table.closeAll();
  });

  it('слишком частые сообщения от одного участника отклоняются', async () => {
    const table = await tableWith(CLASSIC);
    const guest = table.clients[1] as Client;
    for (let i = 0; i < 60; i++) guest.send({ t: 'ready', step: 0, id: 1000 + i });
    await guest.until(() => guest.inbox.filter((m) => m.t === 'ack' || m.t === 'error').length >= 60, 'ответы на 60 сообщений');
    const errors = guest.inbox.filter((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(15);
    expect(errors.every((e) => e.code === 'RATE_LIMITED')).toBe(true);
    // остальных это не касается
    expect(await table.host.request({ t: 'settings', patch: { display: 'open' } })).toMatchObject({ ok: true });
    await table.closeAll();
  });
});
