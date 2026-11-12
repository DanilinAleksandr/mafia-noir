import { describe, expect, it } from 'vitest';
import {
  type GameState,
  createGame,
  createRng,
  resolveNight,
  rngStep,
  seedToState,
  submitNightAction,
  viewFor,
} from '../src/index';
import { Sim, deepFreeze, playRandomGame } from './helpers';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}` }));

describe('Генератор случайных чисел', () => {
  it('одинаковый seed даёт одинаковую последовательность', () => {
    const a = createRng(seedToState('мафия'));
    const b = createRng(seedToState('мафия'));
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(seqA).size).toBe(20);
  });

  it('разные seed дают разные последовательности; числовой и строковый seed равнозначны', () => {
    expect(seedToState('a')).not.toBe(seedToState('b'));
    expect(seedToState(42)).toBe(seedToState('42'));
  });

  it('состояние — одно число: продолжение с сохранённого места даёт то же самое', () => {
    const rng = createRng(seedToState('x'));
    rng.next();
    rng.next();
    const resumed = createRng(rng.state);
    expect(resumed.next()).toBe(rng.next());
    expect(rngStep(123).value).toBe(rngStep(123).value);
  });

  it('shuffle возвращает перестановку и не трогает исходный массив', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...source];
    const shuffled = createRng(seedToState('s')).shuffle(source);
    expect(source).toEqual(copy);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(copy);
  });

  it('int и pick остаются в границах и более-менее равномерны', () => {
    const rng = createRng(seedToState('uniform'));
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) {
      const v = rng.int(4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(800);
    expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
  });
});

describe('Детерминированность игры', () => {
  it('createGame: тот же seed — та же раздача, другой seed — другая', () => {
    const a = createGame({}, players(10), 'seed-1');
    const b = createGame({}, players(10), 'seed-1');
    expect(a).toEqual(b);
    const deals = new Set(
      Array.from({ length: 20 }, (_, i) => createGame({}, players(10), `s${i}`).state.players.map((p) => p.role).join(',')),
    );
    expect(deals.size).toBeGreaterThan(15);
  });

  it('вся игра воспроизводится по seed: то же состояние и тот же журнал событий', () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
      const first = playRandomGame(seed);
      const second = playRandomGame(seed);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
    expect(JSON.stringify(playRandomGame('alpha').log)).not.toBe(JSON.stringify(playRandomGame('beta').log));
  });

  it('состояние — обычный JSON: после сохранения и загрузки игра идёт точно так же', () => {
    const g = new Sim(['mafia', 'mafia', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia#1', 'p4').mafia('mafia#2', 'p5').act('doctor', 'heal', 'p6');
    const restored = JSON.parse(JSON.stringify(g.state)) as GameState;
    expect(restored).toEqual(g.state);
    expect(resolveNight(restored)).toEqual(resolveNight(g.state));
  });

  it('случайная ничья мафии зависит только от состояния генератора', () => {
    const g = new Sim(['mafia', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian'], { seed: 7 });
    g.mafia('mafia#1', 'p3').mafia('mafia#2', 'p4');
    const once = resolveNight(g.state);
    const twice = resolveNight(g.state);
    expect(twice).toEqual(once);
    expect(once.state.rng).not.toBe(g.state.rng);
  });
});

describe('Случайные игры: инварианты', () => {
  it('любая игра заканчивается, итог согласован с состоянием', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const state = playRandomGame(`inv-${i}`);
      expect(state.phase, `inv-${i}`).toBe('ended');
      expect(state.result).not.toBeNull();
      expect(state.pending).toEqual([]);
      const last = state.log[state.log.length - 1];
      expect(last?.type).toBe('gameEnded');
      // номера событий идут подряд с единицы
      expect(state.log.map((e) => e.id)).toEqual(state.log.map((_, index) => index + 1));
      // у каждого погибшего записана смерть, у живых — нет
      for (const p of state.players) expect(p.death === null).toBe(p.alive);
      // событий «death» ровно столько, сколько погибших
      expect(state.log.filter((e) => e.type === 'death')).toHaveLength(state.players.filter((p) => !p.alive).length);
      outcomes.add(state.result?.outcome ?? '');
    }
    // на шестидесяти играх встречаются победы разных сторон
    expect(outcomes.has('red')).toBe(true);
    expect(outcomes.has('black')).toBe(true);
  });

  it('победители соответствуют исходу', () => {
    for (let i = 0; i < 40; i++) {
      const state = playRandomGame(`win-${i}`);
      const result = state.result;
      if (!result) throw new Error('игра не закончилась');
      const winners = state.players.filter((p) => result.winners.includes(p.id));
      for (const p of state.players) {
        const won = result.winners.includes(p.id);
        if (p.role === 'survivor' || p.role === 'mistress') expect(won, `${p.role} win-${i}`).toBe(p.alive);
        else if (p.role === 'jester' || p.role === 'bomber') expect(won).toBe(state.personalWinners.includes(p.id));
        else if (p.role === 'maniac') expect(won).toBe(result.outcome === 'maniac' && p.alive);
        else if (p.team === 'red') expect(won).toBe(result.outcome === 'red');
        else if (p.team === 'black') expect(won).toBe(result.outcome === 'black');
      }
      if (result.outcome === 'red') expect(state.players.some((p) => p.alive && p.team === 'black')).toBe(false);
      if (result.outcome === 'black') expect(winners.some((p) => p.team === 'black')).toBe(true);
    }
  });
});

describe('Неизменяемость', () => {
  it('ни одна функция движка не меняет переданное ей состояние', () => {
    // замороженное состояние: любая попытка записи бросит TypeError
    for (const seed of ['frozen-1', 'frozen-2', 'frozen-3', 'frozen-4', 'frozen-5', 'frozen-6']) {
      const final = playRandomGame(seed, {}, undefined, {
        onState: (state) => {
          deepFreeze(state);
          for (const p of state.players) viewFor(state, p.id);
        },
      });
      expect(final.phase).toBe('ended');
    }
  });

  it('старое состояние остаётся прежним после шага', () => {
    const { state } = createGame({}, players(8), 'immutable');
    const snapshot = JSON.stringify(state);
    const actor = state.players.find((p) => p.team === 'black');
    const victim = state.players.find((p) => p.team !== 'black');
    if (!actor || !victim) throw new Error('нет нужных игроков');
    const next = submitNightAction(state, actor.id, { kind: 'mafiaVote', target: victim.id }).state;
    const after = resolveNight(next).state;
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(next).not.toBe(state);
    expect(after.round).toBe(1);
    expect(after.log.length).toBeGreaterThan(state.log.length);
  });

  it('конфиг вызывающего не меняется и не разделяется с состоянием', () => {
    const config = deepFreeze({ rules: { votingMode: 'open' as const }, composition: { quotas: { black: { exact: 2 } } } });
    const { state } = createGame(config, players(8), 'cfg');
    expect(state.config.rules.votingMode).toBe('open');
    expect(state.config.composition.quotas).toEqual({ black: { exact: 2 } });
    expect(Object.isFrozen(state.config.rules)).toBe(false);
  });
});
