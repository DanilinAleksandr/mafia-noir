import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET } from '@mafia/protocol';
import type { Room } from '../src/room';
import { Client, Table, advanceClock, createRoom, http, roomState, storedRoom, stubOf } from './harness';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Сдвинуть часы комнаты, не трогая будильник. */
async function skew(code: string, ms: number): Promise<void> {
  await runInDurableObject(stubOf(code), (instance: Room) => {
    instance.skewMs += ms;
  });
}

function post(body: unknown): Promise<Response> {
  return http('/api/rooms', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

/** Попытка войти: возвращает код ошибки или undefined, если вошёл. */
async function tryJoin(code: string, name: string, password: string, ip = 'local'): Promise<string | undefined> {
  const client = await Client.open(code, { 'CF-Connecting-IP': ip });
  client.send({ t: 'hello', v: PROTOCOL_VERSION, name, password });
  await client.until(() => client.memberId !== '' || client.closed !== null);
  const error = client.lastError()?.code;
  await client.close();
  return error;
}

describe('Создание комнаты', () => {
  it('выдаёт код из 5 символов без путаных букв и цифр, id хоста и токен', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const created = await createRoom(`Хост ${i}`);
      expect(created.code).toHaveLength(5);
      expect([...created.code].every((ch) => ROOM_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(created.code).not.toMatch(/[01OIL]/);
      expect(created.memberId).toBe('m1');
      expect(created.token.length).toBeGreaterThanOrEqual(32);
      codes.add(created.code);
    }
    expect(codes.size).toBe(5);
  });

  it('проверяет имя и пароль', async () => {
    const cases: [unknown, number, string][] = [
      [{ name: '', password: 'x' }, 400, 'BAD_NAME'],
      [{ name: 'Очень-очень длинное имя игрока', password: 'x' }, 400, 'BAD_NAME'],
      [{ name: 'Аня', password: '' }, 400, 'BAD_PASSWORD'],
      [{ name: 'Аня', password: 'x'.repeat(65) }, 400, 'BAD_PASSWORD'],
      [{ name: 'Аня', password: 'x', hostMode: 'god' }, 400, 'BAD_MESSAGE'],
      ['не json', 400, 'BAD_MESSAGE'],
      ['x'.repeat(3000), 413, 'TOO_LARGE'],
    ];
    for (const [body, status, code] of cases) {
      const response = await post(body);
      expect(response.status, code).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
  });

  it('пароль и токены хранятся только хешами', async () => {
    const created = await createRoom('Хост', 'очень-секретный-пароль');
    const guest = await Client.join(created.code, 'Гость', 'очень-секретный-пароль');
    const stored = await storedRoom(created.code);
    const text = JSON.stringify(stored);
    expect(text).not.toContain('очень-секретный-пароль');
    expect(text).not.toContain(created.token);
    expect(text).not.toContain(guest.token as string);
    expect(stored?.password.iterations).toBe(100_000);
    expect(stored?.password.hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored?.password.salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(stored?.members.map((m) => m.tokenHash.length)).toEqual([64, 64]);
    await guest.close();
  });

  it('у двух комнат с одинаковым паролем разные соль и хеш', async () => {
    const a = await storedRoom((await createRoom('А', 'одинаковый')).code);
    const b = await storedRoom((await createRoom('Б', 'одинаковый')).code);
    expect(a?.password.salt).not.toBe(b?.password.salt);
    expect(a?.password.hash).not.toBe(b?.password.hash);
  });

  it('сведения о комнате: есть, нет, код в любом регистре', async () => {
    const { code } = await createRoom();
    const info = await http(`/api/rooms/${code.toLowerCase()}`);
    expect(await info.json()).toEqual({ code, stage: 'lobby', members: 1, joinable: true });
    expect(info.headers.get('Access-Control-Allow-Origin')).toBe('*');

    for (const missing of ['ZZZZZ', 'абвгд', 'A', 'O0O0O']) {
      const response = await http(`/api/rooms/${encodeURIComponent(missing)}`);
      expect(response.status, missing).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('ROOM_NOT_FOUND');
    }
    expect((await http('/api/rooms/ZZZZZ/ws', { headers: { Upgrade: 'websocket' } })).status).toBe(404);
  });

  it('отладочная страница открывается по / и по ссылке /r/КОД', async () => {
    for (const path of ['/', '/r/ABCDE']) {
      const response = await http(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expect((await response.text()).toLowerCase()).toContain('<!doctype html>');
    }
    expect((await http('/что-то-другое')).status).toBe(404);
  });
});

describe('Вход в комнату', () => {
  it('по имени и паролю: приходит токен, остальные видят нового участника', async () => {
    const table = await Table.create(0);
    const guest = await Client.join(table.code, '  Аня   Петрова ');
    table.clients.push(guest);
    await table.settle();
    expect(guest.memberId).toBe('m2');
    expect(guest.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(guest.inbox[0]).toMatchObject({ t: 'welcome', v: PROTOCOL_VERSION, memberId: 'm2', game: null, history: [], chat: [] });
    expect(table.host.room?.members).toEqual([
      { id: 'm1', name: 'Хост', online: true, isHost: true, playing: true },
      { id: 'm2', name: 'Аня Петрова', online: true, isHost: false, playing: true },
    ]);
    await table.closeAll();
  });

  it('неверный пароль: отказ, счётчик попыток, соединение закрыто', async () => {
    const { code } = await createRoom();
    const client = await Client.open(code);
    client.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Взломщик', password: 'не тот' });
    await client.untilClosed();
    expect(client.lastError()).toMatchObject({ code: 'WRONG_PASSWORD', message: 'Неверный пароль. Осталось попыток: 4' });
    expect(client.closed?.code).toBe(4000);
    expect((await roomState(code))?.members).toHaveLength(1);
  });

  it('после пяти неверных попыток адрес блокируется, даже с верным паролем; другой адрес входит', async () => {
    const { code } = await createRoom();
    const results: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) results.push(await tryJoin(code, `Гость ${i}`, 'мимо', '10.0.0.1'));
    expect(results).toEqual(['WRONG_PASSWORD', 'WRONG_PASSWORD', 'WRONG_PASSWORD', 'WRONG_PASSWORD', 'TOO_MANY_ATTEMPTS']);
    expect(await tryJoin(code, 'Гость 5', 'пароль', '10.0.0.1')).toBe('TOO_MANY_ATTEMPTS');
    // с другого адреса вход работает
    expect(await tryJoin(code, 'Гость 6', 'пароль', '10.0.0.2')).toBeUndefined();
    // через 10 минут блокировка снимается
    await skew(code, 10 * MINUTE + 1000);
    expect(await tryJoin(code, 'Гость 7', 'пароль', '10.0.0.1')).toBeUndefined();
  });

  it('есть и общий лимит на комнату: перебор с разных адресов тоже блокируется', async () => {
    const { code } = await createRoom();
    for (let i = 0; i < 30; i++) await tryJoin(code, `Гость ${i}`, 'мимо', `10.1.0.${i}`);
    expect(await tryJoin(code, 'Свежий', 'пароль', '10.2.0.1')).toBe('TOO_MANY_ATTEMPTS');
    await skew(code, 10 * MINUTE + 1000);
    expect(await tryJoin(code, 'Свежий', 'пароль', '10.2.0.1')).toBeUndefined();
  });

  it('блокировка не мешает переподключению по токену', async () => {
    const created = await createRoom();
    for (let i = 0; i < 5; i++) await tryJoin(created.code, 'Взломщик', 'мимо');
    const host = await Client.resume(created.code, created.token);
    expect(host.memberId).toBe('m1');
    await host.close();
  });

  it('имена: пустое и занятое (без учёта регистра) отклоняются', async () => {
    const { code } = await createRoom('Аня');
    expect(await tryJoin(code, '   ', 'пароль')).toBe('BAD_NAME');
    expect(await tryJoin(code, 'аНЯ', 'пароль')).toBe('NAME_TAKEN');
    expect(await tryJoin(code, 'x'.repeat(21), 'пароль')).toBe('BAD_NAME');
    expect((await roomState(code))?.members).toHaveLength(1);
  });

  it('чужая версия протокола, мусор и сообщения до входа закрывают соединение', async () => {
    const { code } = await createRoom();
    const cases: [string, string][] = [
      [JSON.stringify({ t: 'hello', v: 999, name: 'Аня', password: 'пароль' }), 'PROTOCOL_VERSION'],
      ['это не json', 'BAD_MESSAGE'],
      [JSON.stringify({ t: 'неизвестное' }), 'BAD_MESSAGE'],
      [JSON.stringify({ t: 'start' }), 'NOT_AUTHENTICATED'],
      [JSON.stringify({ t: 'vote', target: 'm1' }), 'NOT_AUTHENTICATED'],
      ['x'.repeat(20_000), 'TOO_LARGE'],
    ];
    for (const [raw, error] of cases) {
      const client = await Client.open(code);
      client.sendRaw(raw);
      await client.untilClosed();
      expect(client.lastError()?.code, raw.slice(0, 30)).toBe(error);
      expect(client.closed?.code).toBe(4000);
    }
  });

  it('повторный hello и некорректные сообщения после входа — ошибка без разрыва', async () => {
    const table = await Table.create(0);
    expect(await table.host.request({ t: 'hello', v: PROTOCOL_VERSION, token: 'что-то' })).toMatchObject({
      ok: false,
      code: 'ALREADY_AUTHENTICATED',
    });
    table.host.sendRaw(JSON.stringify({ t: 'night', id: 77, action: { kind: 'ability', ability: 'нет такой', targets: ['m1'] } }));
    await table.host.until(() => table.host.lastError()?.re === 77);
    expect(table.host.lastError()).toMatchObject({ code: 'BAD_MESSAGE', message: 'Некорректное ночное действие' });
    expect(table.host.closed).toBeNull();
    await table.closeAll();
  });

  it('в комнате не больше 20 участников', async () => {
    const table = await Table.create(19);
    expect((await table.state()).members).toHaveLength(20);
    expect(await tryJoin(table.code, 'Лишний', 'пароль')).toBe('ROOM_FULL');
    expect(await (await http(`/api/rooms/${table.code}`)).json()).toMatchObject({ members: 20, joinable: false });
    await table.closeAll();
  });

  it('после старта новые игроки не входят, а после возврата в лобби — снова входят', async () => {
    const table = await Table.create(3);
    await table.start();
    expect(await (await http(`/api/rooms/${table.code}`)).json()).toMatchObject({ stage: 'game', joinable: false });
    expect(await tryJoin(table.code, 'Опоздавший', 'пароль')).toBe('ROOM_STARTED');

    await table.host.ok({ t: 'toLobby' });
    const next = await Client.join(table.code, 'Опоздавший');
    expect(next.room?.stage).toBe('lobby');
    expect(next.game).toBeNull();
    table.clients.push(next);
    await table.closeAll();
  });
});

describe('Переподключение', () => {
  it('по токену возвращается тот же участник; токен повторно не присылается', async () => {
    const table = await Table.create(1);
    const guest = table.clients[1] as Client;
    const token = guest.token as string;
    await guest.close();
    await table.settle();
    expect(table.host.room?.members[1]).toMatchObject({ id: 'm2', online: false });

    const again = await Client.resume(table.code, token);
    table.clients.push(again);
    await table.settle();
    expect(again.memberId).toBe('m2');
    expect(again.inbox[0]).toMatchObject({ t: 'welcome', token: null });
    expect(table.host.room?.members[1]).toMatchObject({ id: 'm2', online: true });
    await table.closeAll();
  });

  it('неизвестный токен отклоняется', async () => {
    const { code } = await createRoom();
    const client = await Client.open(code);
    client.send({ t: 'hello', v: PROTOCOL_VERSION, token: 'A'.repeat(32) });
    await client.untilClosed();
    expect(client.lastError()?.code).toBe('BAD_TOKEN');
  });

  it('второе соединение того же участника вытесняет первое', async () => {
    const table = await Table.create(1);
    const first = table.clients[1] as Client;
    const second = await Client.resume(table.code, first.token as string);
    await first.untilClosed();
    expect(first.byes()[0]).toMatchObject({ code: 'REPLACED' });
    expect(first.closed?.code).toBe(4002);
    table.clients.push(second);
    await table.settle();
    // участник остался в сети
    expect(table.host.room?.members[1]).toMatchObject({ id: 'm2', online: true });
    await table.closeAll();
  });

  it('в партии переподключившийся получает свой снимок и свой журнал', async () => {
    const table = await Table.create(4);
    await table.start();
    const player = table.clients[2] as Client;
    const before = { view: player.game?.view, events: player.events };
    await player.close();
    const again = await Client.resume(table.code, player.token as string);
    table.clients.push(again);
    await table.settle();
    expect(again.game?.view).toEqual(before.view);
    expect(again.events).toEqual(before.events);
    expect(again.events.filter((e) => e.type === 'roleAssigned')).toHaveLength(1);
    expect(again.game?.stage).toBe('night');
    await table.closeAll();
  });
});

describe('Хост', () => {
  it('исключает участника: соединение закрыто, токен больше не действует', async () => {
    const table = await Table.create(2);
    const [host, a, b] = table.clients as [Client, Client, Client];
    expect(await a.request({ t: 'kick', memberId: b.memberId })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(await host.request({ t: 'kick', memberId: 'm99' })).toMatchObject({ ok: false, code: 'UNKNOWN_MEMBER' });
    expect(await host.request({ t: 'kick', memberId: host.memberId })).toMatchObject({ ok: false });

    await host.ok({ t: 'kick', memberId: b.memberId });
    await b.untilClosed();
    expect(b.byes()[0]).toMatchObject({ code: 'KICKED', message: 'Хост исключил вас из комнаты' });
    expect(b.closed?.code).toBe(4001);
    await table.settle();
    expect(host.room?.members.map((m) => m.id)).toEqual(['m1', 'm2']);

    const back = await Client.open(table.code);
    back.send({ t: 'hello', v: PROTOCOL_VERSION, token: b.token as string });
    await back.untilClosed();
    expect(back.lastError()?.code).toBe('BAD_TOKEN');
    await table.closeAll();
  });

  it('во время партии исключать и выходить нельзя', async () => {
    const table = await Table.create(3);
    await table.start();
    expect(await table.host.request({ t: 'kick', memberId: 'm2' })).toMatchObject({ ok: false, code: 'WRONG_STAGE' });
    expect(await (table.clients[1] as Client).request({ t: 'leave' })).toMatchObject({ ok: false, code: 'WRONG_STAGE' });
    await table.closeAll();
  });

  it('передаёт права другому участнику', async () => {
    const table = await Table.create(2);
    const [host, a] = table.clients as [Client, Client];
    expect(await a.request({ t: 'transferHost', memberId: a.memberId })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    await host.ok({ t: 'transferHost', memberId: a.memberId });
    await table.settle();
    expect(a.room?.hostId).toBe(a.memberId);
    expect(a.room?.members.map((m) => m.isHost)).toEqual([false, true, false]);
    expect(await host.request({ t: 'start' })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    await table.closeAll();
  });

  it('участник выходит сам; если выходит хост, права переходят следующему', async () => {
    const table = await Table.create(2);
    const [host, a, b] = table.clients as [Client, Client, Client];
    b.send({ t: 'leave' });
    await b.untilClosed();
    expect(b.byes()[0]?.code).toBe('LEFT');
    host.send({ t: 'leave' });
    await host.untilClosed();
    await table.settle();
    expect(a.room).toMatchObject({ hostId: 'm2', members: [{ id: 'm2', isHost: true }] });
    await table.closeAll();
  });

  it('когда выходит последний участник, комната удаляется', async () => {
    const table = await Table.create(0);
    table.host.send({ t: 'leave' });
    await table.host.untilClosed();
    expect(await roomState(table.code)).toBeNull();
    expect((await http(`/api/rooms/${table.code}`)).status).toBe(404);
    expect(await storedRoom(table.code)).toBeUndefined();
  });

  it('отключился дольше двух минут — права автоматически переходят первому, кто в сети', async () => {
    const table = await Table.create(2);
    const [host, a, b] = table.clients as [Client, Client, Client];
    await a.close();
    await host.close();
    await table.settle();
    expect(b.room?.members.map((m) => m.online)).toEqual([false, false, true]);

    await table.tick(119_000);
    expect(b.room?.hostId).toBe('m1');
    await table.tick(2_000);
    expect(b.room?.hostId).toBe('m3');
    expect((await table.state()).hostOfflineSince).toBeNull();

    // прежний хост вернулся — он обычный участник
    const back = await Client.resume(table.code, host.token as string);
    table.clients.push(back);
    await table.settle();
    expect(back.room?.hostId).toBe('m3');
    expect(await back.request({ t: 'start' })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    await table.closeAll();
  });

  it('вернулся раньше двух минут — остаётся хостом', async () => {
    const table = await Table.create(1);
    const host = table.host;
    await host.close();
    await table.tick(60_000);
    const back = await Client.resume(table.code, host.token as string);
    table.clients.push(back);
    await table.tick(120_000);
    expect(back.room?.hostId).toBe('m1');
    expect((await table.state()).hostOfflineSince).toBeNull();
    await table.closeAll();
  });

  it('если в сети никого нет, права получит первый вернувшийся', async () => {
    const table = await Table.create(1);
    const [host, a] = table.clients as [Client, Client];
    await a.close();
    await host.close();
    // будильник срабатывает, но передать права некому
    await advanceClock(table.code, 5 * MINUTE);
    expect((await roomState(table.code))?.hostId).toBe('m1');

    const back = await Client.resume(table.code, a.token as string);
    table.clients.push(back);
    await table.settle();
    expect(back.room?.hostId).toBe('m2');
    await table.closeAll();
  });

  it('режим ведущего: хост не получает роль, не ходит, но видит все роли', async () => {
    const table = await Table.create(4, { hostMode: 'narrator' });
    expect(table.host.room?.members.map((m) => m.playing)).toEqual([false, true, true, true, true]);
    const game = await table.start();
    expect(game.players.map((p) => p.id)).toEqual(['m2', 'm3', 'm4', 'm5']);
    expect(table.host.game?.view.viewer).toBeNull();
    expect(table.host.game?.view.you).toBeNull();
    expect(table.host.game?.view.players.map((p) => p.role)).toEqual(game.players.map((p) => p.role));
    expect(table.host.events.filter((e) => e.type === 'roleAssigned')).toHaveLength(4);
    expect(table.host.game?.view.backstage).not.toBeNull();
    expect(await table.host.request({ t: 'night', action: { kind: 'pass' } })).toMatchObject({ ok: false, code: 'NOT_PLAYING' });
    // игроки по-прежнему видят только себя
    const guest = table.clients[1] as Client;
    expect(guest.game?.view.backstage).toBeNull();
    expect(guest.events.filter((e) => e.type === 'roleAssigned')).toHaveLength(1);
    await table.closeAll();
  });

  it('режим хоста переключается в настройках', async () => {
    const table = await Table.create(1);
    expect(table.host.room?.members[0]?.playing).toBe(true);
    await table.host.ok({ t: 'settings', patch: { hostMode: 'narrator' } });
    await table.settle();
    expect(table.host.room?.members[0]?.playing).toBe(false);
    expect(table.host.room?.settings.hostMode).toBe('narrator');
    await table.closeAll();
  });
});

describe('Настройки комнаты', () => {
  it('по умолчанию: скрытный режим, таймеры выключены, хост играет', async () => {
    const table = await Table.create(0);
    expect(table.host.room?.settings).toMatchObject({
      hostMode: 'player',
      display: 'stealth',
      timers: { night: null, discussion: null, day: null, decision: null },
      composition: { roles: {}, quotas: {}, preset: null, minCiviliansShare: null },
    });
    expect(table.host.room?.settings.rules.votingMode).toBe('secret');
    await table.closeAll();
  });

  it('хост меняет настройки — все видят; гость менять не может', async () => {
    const table = await Table.create(1);
    const [host, guest] = table.clients as [Client, Client];
    await host.ok({
      t: 'settings',
      patch: {
        display: 'cinema',
        timers: { night: 60 },
        rules: { votingMode: 'open', revealRoleOnDeath: false },
        composition: { roles: { maniac: { enabled: false } }, quotas: { black: { exact: 1 } }, minCiviliansShare: 0.5 },
      },
    });
    await table.settle();
    expect(guest.room?.settings).toMatchObject({
      display: 'cinema',
      timers: { night: 60, discussion: null, day: null, decision: null },
      composition: { roles: { maniac: { enabled: false } }, quotas: { black: { exact: 1 } }, minCiviliansShare: 0.5 },
    });
    expect(guest.room?.settings.rules).toMatchObject({ votingMode: 'open', revealRoleOnDeath: false, announceSaves: true });
    expect(await guest.request({ t: 'settings', patch: { display: 'open' } })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    await table.closeAll();
  });

  it('некорректные настройки отклоняются с объяснением', async () => {
    const table = await Table.create(0);
    const cases: [unknown, string][] = [
      [{ display: 'голограмма' }, 'Неизвестный режим показа событий'],
      [{ timers: { night: 3 } }, 'Таймер должен быть выключен или задан в секундах от 10 до 3600'],
      [{ rules: { votingMode: 'loud' } }, 'Недопустимое значение правила votingMode'],
      [{ rules: { cheats: true } }, 'Неизвестное правило: cheats'],
      [{ composition: { roles: { wizard: { enabled: true } } } }, 'Неизвестная роль: wizard'],
      [{ composition: { quotas: { black: { min: -1 } } } }, 'Квота black: значение должно быть целым числом от 0 до 20'],
      [{ composition: { minCiviliansShare: 2 } }, 'Доля Мирных жителей должна быть числом от 0 до 1'],
      [{ secret: 1 }, 'Неизвестная настройка: secret'],
    ];
    for (const [patch, message] of cases) {
      table.host.sendRaw(JSON.stringify({ t: 'settings', id: 5, patch }));
      await table.host.until(() => table.host.lastError()?.message === message, message);
      expect(table.host.lastError()).toMatchObject({ code: 'BAD_SETTINGS', re: 5 });
    }
    await table.closeAll();
  });

  it('пока игроков мало или состав не сходится, начать нельзя — и видно почему', async () => {
    const table = await Table.create(1);
    expect(table.host.room?.startIssues).toEqual(['Нужно минимум 4 игрока, а игроков 2']);
    expect(await table.host.request({ t: 'start' })).toMatchObject({ ok: false, code: 'CANNOT_START' });

    for (let i = 0; i < 4; i++) table.clients.push(await Client.join(table.code, `Ещё ${i}`));
    await table.settle();
    expect(table.host.room?.startIssues).toEqual([]);
    await table.host.ok({ t: 'settings', patch: { composition: { quotas: { black: { exact: 4 } } } } });
    await table.settle();
    expect(table.host.room?.startIssues[0]).toContain('Чёрные');
    const reply = await table.host.request({ t: 'start' });
    expect(reply).toMatchObject({ ok: false, code: 'CANNOT_START' });
    expect(reply.ok ? '' : reply.message).toContain('Не удалось собрать состав');
    await table.closeAll();
  });

  it('во время партии настройки менять нельзя', async () => {
    const table = await Table.create(3);
    await table.start();
    expect(await table.host.request({ t: 'settings', patch: { display: 'open' } })).toMatchObject({ ok: false, code: 'WRONG_STAGE' });
    expect(await table.host.request({ t: 'start' })).toMatchObject({ ok: false, code: 'WRONG_STAGE' });
    await table.closeAll();
  });
});

describe('Простой комнаты', () => {
  it('через 6 часов без активности комната удаляется, соединения закрываются', async () => {
    const table = await Table.create(1);
    const guest = table.clients[1] as Client;
    await advanceClock(table.code, 6 * HOUR + 1000);
    await guest.untilClosed();
    expect(guest.byes()[0]).toMatchObject({ code: 'ROOM_CLOSED' });
    expect(guest.closed?.code).toBe(4003);
    expect(await roomState(table.code)).toBeNull();
    expect(await storedRoom(table.code)).toBeUndefined();
    expect((await http(`/api/rooms/${table.code}`)).status).toBe(404);
  });

  it('активность откладывает удаление', async () => {
    const table = await Table.create(1);
    await skew(table.code, 5 * HOUR);
    await table.host.ok({ t: 'settings', patch: { display: 'open' } });
    // прошло 6 часов с создания, но только час с последнего действия
    await table.tick(HOUR + 1000);
    expect(await roomState(table.code)).not.toBeNull();
    // ещё пять часов тишины — теперь удаляется
    await advanceClock(table.code, 5 * HOUR);
    expect(await roomState(table.code)).toBeNull();
  });
});

describe('Ручной состав и скрытный режим', () => {
  const preset = ['mafia', 'doctor', 'civilian', 'civilian'] as const;

  it('в скрытном режиме состав, заданный хостом, видит только хост', async () => {
    const table = await Table.create(3, { settings: { composition: { preset: [...preset] } } });
    const [host, guest] = table.clients as [Client, Client];
    expect(host.room?.settings.composition.preset).toEqual(preset);
    expect(host.room?.presetHidden).toBe(false);
    expect(guest.room?.settings.composition.preset).toBeNull();
    expect(guest.room?.presetHidden).toBe(true);
    expect(guest.raw.join('\n')).not.toContain('"doctor"');

    // то же — при входе и во время партии
    const late = await Client.resume(table.code, guest.token as string);
    await guest.untilClosed();
    expect(late.room).toMatchObject({ presetHidden: true });
    expect(late.room?.settings.composition.preset).toBeNull();
    table.clients.push(late);
    await table.start();
    expect(late.room).toMatchObject({ stage: 'game', presetHidden: true });
    await table.closeAll();
  });

  it('в открытых режимах состав и так известен всем — ручной состав не скрывается', async () => {
    const table = await Table.create(3, { settings: { display: 'open', composition: { preset: [...preset] } } });
    const guest = table.clients[1] as Client;
    expect(guest.room?.settings.composition.preset).toEqual(preset);
    expect(guest.room?.presetHidden).toBe(false);
    await table.closeAll();
  });

  it('новый хост начинает видеть состав, прежний — перестаёт', async () => {
    const table = await Table.create(3, { settings: { composition: { preset: [...preset] } } });
    const [host, guest] = table.clients as [Client, Client];
    await host.ok({ t: 'transferHost', memberId: guest.memberId });
    await table.settle();
    expect(guest.room?.settings.composition.preset).toEqual(preset);
    expect(host.room?.settings.composition.preset).toBeNull();
    await table.closeAll();
  });
});
