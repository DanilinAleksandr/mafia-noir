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
    expect(table.host.game?.stage).toBe('night');
    expect(table.host.game?.view.round).toBe(2);
    expect((await table.game()).players.find((p) => p.id === target)?.alive).toBe(false);
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
    expect(table.host.game?.stage).toBe('night');
    await table.closeAll();
  });

  it('хост может подвести итог досрочно', async () => {
    const table = await toDay();
    await table.host.ok({ t: 'advance', step: table.host.game?.step ?? -1 });
    await table.settle();
    expect(table.host.game?.stage).toBe('night');
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
    expect(table.host.game?.stage).toBe('night');
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
    await table.settle();
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

  it('«Кино»: после ночи все получают обезличенные сцены — роль и тип, без игроков', async () => {
    const table = await tableWith(SET, { display: 'cinema' });
    await table.start();
    expect(table.host.scenes).toEqual([]);
    await eventfulNight(table);
    const expected = [
      { round: 1, type: 'mafiaTargetChosen', role: null },
      { round: 1, type: 'saved', role: 'doctor' },
      { round: 1, type: 'checked', role: 'commissioner' },
    ];
    for (const client of table.clients) {
      expect(client.scenes.map(({ round, type, role }) => ({ round, type, role }))).toEqual(expected);
      expect(client.scenes.every((s) => Object.keys(s).sort().join() === 'id,role,round,type')).toBe(true);
      expect(client.game?.composition).toHaveLength(4);
    }
    // сам результат проверки по-прежнему видит только Комиссар
    const civilian = await table.seat('civilian', 1);
    expect(civilian.client.events.some((e) => e.type === 'checked')).toBe(false);
    expect((await table.seat('commissioner')).client.events.find((e) => e.type === 'checked')?.data).toEqual({ isMafia: true });

    // переподключившийся получает сцены заново
    await civilian.client.close();
    const again = await Client.resume(table.code, civilian.client.token as string);
    expect(again.scenes.map(({ round, type, role }) => ({ round, type, role }))).toEqual(expected);
    table.clients.push(again);
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
