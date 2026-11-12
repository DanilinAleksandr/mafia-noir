import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@mafia/engine';
import {
  ERROR_MESSAGES,
  LIMITS,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  applySettingsPatch,
  checkCreateRoom,
  checkSettingsPatch,
  defaultRoomSettings,
  engineErrorCode,
  errorText,
  generateRoomCode,
  normalizeChatText,
  normalizeName,
  normalizeRoomCode,
  parseClientMessage,
  roomCodeFromBytes,
} from '../src/index';

const parse = (value: unknown) => parseClientMessage(typeof value === 'string' ? value : JSON.stringify(value));

describe('Разбор сообщений клиента', () => {
  it('принимает все виды корректных сообщений', () => {
    const valid: unknown[] = [
      { t: 'hello', v: PROTOCOL_VERSION, token: 'abc' },
      { t: 'hello', v: PROTOCOL_VERSION, name: 'Аня', password: '1234' },
      { t: 'settings', patch: { display: 'cinema' } },
      { t: 'kick', memberId: 'm2' },
      { t: 'transferHost', memberId: 'm2' },
      { t: 'leave' },
      { t: 'start' },
      { t: 'toLobby' },
      { t: 'night', action: { kind: 'pass' } },
      { t: 'night', action: { kind: 'mafiaVote', target: null } },
      { t: 'night', action: { kind: 'mafiaVote', target: 'm3' } },
      { t: 'night', action: { kind: 'ability', ability: 'heal', targets: ['m3'] } },
      { t: 'night', action: { kind: 'ability', ability: 'compare', targets: ['m3', 'm4'] } },
      { t: 'vote', target: null },
      { t: 'vote', target: 'm3' },
      { t: 'decision', decision: { kind: 'hunterShot', target: null } },
      { t: 'decision', decision: { kind: 'bomberBlast', target: 'm3' } },
      { t: 'decision', decision: { kind: 'judgeVeto', veto: true } },
      { t: 'ready', step: 4 },
      { t: 'advance', step: 4 },
      { t: 'chat', text: 'привет' },
    ];
    for (const message of valid) {
      const result = parse(message);
      expect(result.ok, JSON.stringify(message)).toBe(true);
      if (result.ok) expect(result.value).toEqual(message);
    }
  });

  it('сохраняет номер запроса и отбрасывает лишние поля', () => {
    const result = parse({ t: 'vote', target: 'm3', id: 12, admin: true, role: 'don' });
    expect(result).toEqual({ ok: true, value: { t: 'vote', target: 'm3', id: 12 } });
    const chat = parse({ t: 'chat', text: '  привет  ' });
    expect(chat.ok && chat.value).toEqual({ t: 'chat', text: 'привет' });
  });

  it('отклоняет некорректные сообщения с кодом ошибки', () => {
    const invalid: [unknown, string][] = [
      ['не json', 'BAD_MESSAGE'],
      ['[]', 'BAD_MESSAGE'],
      ['null', 'BAD_MESSAGE'],
      [{ noType: 1 }, 'BAD_MESSAGE'],
      [{ t: 'взлом' }, 'BAD_MESSAGE'],
      [{ t: 'hello' }, 'BAD_MESSAGE'],
      [{ t: 'hello', v: 1 }, 'BAD_NAME'],
      [{ t: 'hello', v: 1, name: 'Аня' }, 'BAD_PASSWORD'],
      [{ t: 'hello', v: 1, token: 'x'.repeat(200) }, 'BAD_TOKEN'],
      [{ t: 'kick' }, 'BAD_MESSAGE'],
      [{ t: 'kick', memberId: 5 }, 'BAD_MESSAGE'],
      [{ t: 'night', action: { kind: 'ability', ability: 'nuke', targets: ['m1'] } }, 'BAD_MESSAGE'],
      [{ t: 'night', action: { kind: 'ability', ability: 'heal', targets: [] } }, 'BAD_MESSAGE'],
      [{ t: 'night', action: { kind: 'ability', ability: 'heal', targets: ['a', 'b', 'c'] } }, 'BAD_MESSAGE'],
      [{ t: 'night', action: { kind: 'mafiaVote' } }, 'BAD_MESSAGE'],
      [{ t: 'vote' }, 'BAD_MESSAGE'],
      [{ t: 'vote', target: { $ne: null } }, 'BAD_MESSAGE'],
      [{ t: 'decision', decision: { kind: 'judgeVeto', veto: 'да' } }, 'BAD_MESSAGE'],
      [{ t: 'decision', decision: { kind: 'bomberBlast', target: null } }, 'BAD_MESSAGE'],
      [{ t: 'ready', step: -1 }, 'BAD_MESSAGE'],
      [{ t: 'ready', step: 1.5 }, 'BAD_MESSAGE'],
      [{ t: 'chat', text: '' }, 'BAD_MESSAGE'],
      [{ t: 'chat', text: 'я'.repeat(LIMITS.chatMax + 1) }, 'BAD_MESSAGE'],
      [{ t: 'vote', target: 'm1', id: 'семь' }, 'BAD_MESSAGE'],
      [{ t: 'settings', patch: { display: 'x' } }, 'BAD_SETTINGS'],
      ['x'.repeat(LIMITS.messageChars + 1), 'TOO_LARGE'],
      [42 as unknown, 'BAD_MESSAGE'],
    ];
    for (const [message, code] of invalid) {
      const result = typeof message === 'number' ? parseClientMessage(message) : parse(message);
      expect(result.ok, JSON.stringify(message).slice(0, 60)).toBe(false);
      if (!result.ok) {
        expect(result.code, JSON.stringify(message).slice(0, 60)).toBe(code);
        expect(result.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('в ошибке возвращается номер запроса, если его удалось прочитать', () => {
    const result = parse({ t: 'kick', id: 9 });
    expect(result).toMatchObject({ ok: false, re: 9 });
    expect(parse('мусор')).toMatchObject({ ok: false, re: null });
  });
});

describe('Имена, чат, создание комнаты', () => {
  it('имя: лишние пробелы и невидимые символы убираются, длина ограничена', () => {
    expect(normalizeName('  Аня   Петрова ')).toBe('Аня Петрова');
    expect(normalizeName(`А${String.fromCharCode(0x200b)}ня${String.fromCharCode(0x202e)}`)).toBe('Аня');
    expect(normalizeName(`Аня${String.fromCharCode(10)}Петрова`)).toBe('АняПетрова');
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('я'.repeat(20))).toBe('я'.repeat(20));
    expect(normalizeName('я'.repeat(21))).toBeNull();
    // эмодзи — один символ, а не два
    expect(normalizeName('🎭'.repeat(20))).toBe('🎭'.repeat(20));
    expect(normalizeName(42)).toBeNull();
  });

  it('чат: перевод строки разрешён, управляющие символы — нет', () => {
    expect(normalizeChatText(`раз${String.fromCharCode(10)}два`)).toBe(`раз${String.fromCharCode(10)}два`);
    expect(normalizeChatText(`раз${String.fromCharCode(7)}два`)).toBe('раздва');
    expect(normalizeChatText('   ')).toBeNull();
  });

  it('запрос на создание комнаты', () => {
    expect(checkCreateRoom({ name: ' Хост ', password: 'p' })).toEqual({
      ok: true,
      value: { name: 'Хост', password: 'p', hostMode: 'player' },
    });
    expect(checkCreateRoom({ name: 'Хост', password: 'p', hostMode: 'narrator' })).toMatchObject({
      ok: true,
      value: { hostMode: 'narrator' },
    });
    expect(checkCreateRoom({ name: '', password: 'p' })).toEqual({ ok: false, code: 'BAD_NAME' });
    expect(checkCreateRoom({ name: 'Хост' })).toEqual({ ok: false, code: 'BAD_PASSWORD' });
    expect(checkCreateRoom('строка')).toEqual({ ok: false, code: 'BAD_MESSAGE' });
  });
});

describe('Настройки комнаты', () => {
  it('по умолчанию: скрытный режим, таймеры выключены, правила движка по умолчанию', () => {
    expect(defaultRoomSettings()).toEqual({
      hostMode: 'player',
      display: 'stealth',
      timers: { night: null, day: null, decision: null },
      rules: DEFAULT_RULES,
      composition: { roles: {}, quotas: {}, preset: null, minCiviliansShare: null },
    });
    expect(defaultRoomSettings('narrator').hostMode).toBe('narrator');
  });

  it('изменение применяется поверх текущих настроек и не трогает исходный объект', () => {
    const before = defaultRoomSettings();
    const snapshot = JSON.stringify(before);
    const checked = checkSettingsPatch({
      display: 'open',
      timers: { day: 120 },
      rules: { votingMode: 'open' },
      composition: { roles: { maniac: { enabled: false }, doctor: { max: 2 } }, preset: ['mafia', 'civilian'] },
    });
    if (!checked.ok) throw new Error(checked.message);
    const after = applySettingsPatch(before, checked.value);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).toMatchObject({
      display: 'open',
      timers: { night: null, day: 120, decision: null },
      composition: { roles: { maniac: { enabled: false }, doctor: { max: 2 } }, quotas: {}, preset: ['mafia', 'civilian'] },
    });
    expect(after.rules).toEqual({ ...DEFAULT_RULES, votingMode: 'open' });

    // roles и quotas заменяются целиком, остальное сохраняется
    const next = applySettingsPatch(after, { composition: { roles: {}, preset: null }, timers: { day: null } });
    expect(next.composition).toEqual({ roles: {}, quotas: {}, preset: null, minCiviliansShare: null });
    expect(next.timers.day).toBeNull();
    expect(next.display).toBe('open');
  });

  it('некорректные изменения отклоняются с объяснением', () => {
    const invalid: unknown[] = [
      null,
      [],
      { hostMode: 'bot' },
      { timers: { night: 5 } },
      { timers: { night: 5000 } },
      { timers: { lunch: 30 } },
      { rules: { revealRoleOnDeath: 'yes' } },
      { rules: { mistressMode: 'black' } },
      { composition: { roles: { doctor: { max: 99 } } } },
      { composition: { roles: { doctor: { admin: true } } } },
      { composition: { quotas: { purple: { min: 1 } } } },
      { composition: { quotas: { black: { min: 1.5 } } } },
      { composition: { preset: ['mafia', 'unicorn'] } },
      { composition: { preset: 'mafia' } },
      { composition: { minCiviliansShare: -1 } },
      { composition: { seed: 1 } },
    ];
    for (const patch of invalid) {
      const checked = checkSettingsPatch(patch);
      expect(checked.ok, JSON.stringify(patch)).toBe(false);
      if (!checked.ok) expect(checked.message.length).toBeGreaterThan(5);
    }
  });
});

describe('Коды комнат', () => {
  it('в алфавите нет похожих друг на друга символов', () => {
    for (const ch of '01OIL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('генерация: нужная длина, только символы алфавита, без перекоса', () => {
    let seed = 1;
    const bytes = (count: number) => {
      const out = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        out[i] = (seed >>> 16) & 0xff;
      }
      return out;
    };
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const code = generateRoomCode(bytes);
      expect(code).toHaveLength(5);
      for (const ch of code) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(ROOM_CODE_ALPHABET.length);
    const expected = (3000 * 5) / ROOM_CODE_ALPHABET.length;
    for (const count of counts.values()) expect(Math.abs(count - expected)).toBeLessThan(expected * 0.35);
    expect(generateRoomCode(bytes, 6)).toHaveLength(6);
  });

  it('байты вне ровного диапазона отбрасываются', () => {
    expect(roomCodeFromBytes(new Uint8Array([255, 255, 255, 255, 255]))).toBeNull();
    expect(roomCodeFromBytes(new Uint8Array([0, 1, 2, 3, 4]))).toBe('ABCDE');
    expect(roomCodeFromBytes(new Uint8Array([255, 0, 255, 1, 2, 3, 4]))).toBe('ABCDE');
  });

  it('нормализация ввода: регистр, пробелы и дефисы', () => {
    expect(normalizeRoomCode('abcde')).toBe('ABCDE');
    expect(normalizeRoomCode(' ab-cde ')).toBe('ABCDE');
    expect(normalizeRoomCode('ABCDEF')).toBe('ABCDEF');
    for (const bad of ['ABCD', 'ABCDEFG', 'ABCD0', 'ABCDO', 'абвгд', '', 5, null]) {
      expect(normalizeRoomCode(bad), String(bad)).toBeNull();
    }
  });
});

describe('Ошибки', () => {
  it('у каждого кода есть русский текст', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(5);
      expect(message, code).toMatch(/[а-яё]/i);
    }
  });

  it('ошибки движка переводятся в коды протокола', () => {
    for (const code of [
      'WRONG_PHASE',
      'DECISION_PENDING',
      'NO_DECISION',
      'UNKNOWN_PLAYER',
      'PLAYER_DEAD',
      'INVALID_ACTION',
      'INVALID_TARGET',
      'INVALID_CONFIG',
      'INVALID_COMPOSITION',
    ]) {
      expect(engineErrorCode(code)).toBe(`GAME_${code}`);
    }
    expect(engineErrorCode('ЧТО-ТО НОВОЕ')).toBe('INTERNAL');
    expect(errorText('NOT_HOST')).toBe(ERROR_MESSAGES.NOT_HOST);
    expect(errorText('WRONG_PASSWORD', 'Осталось попыток: 2')).toBe('Осталось попыток: 2');
  });
});
