import { describe, expect, it } from 'vitest';
import { EngineError, checkWin } from '../src/index';
import { Sim } from './helpers';

describe('Победа красных', () => {
  it('когда казнён последний мафиози; побеждают все красные, включая погибших', () => {
    const g = new Sim(['mafia', 'doctor', 'civilian', 'civilian', 'civilian']);
    expect(checkWin(g.state)).toBeNull();
    g.mafia('mafia', 'p3').night();
    expect(checkWin(g.state)).toBeNull();
    g.voteAll('mafia');
    g.tally();
    expect(g.state.phase).toBe('ended');
    expect(g.state.result).toEqual({
      outcome: 'red',
      reason: 'threatsEliminated',
      winners: ['p2', 'p3', 'p4', 'p5'],
    });
    expect(checkWin(g.state)).toEqual(g.state.result);
    const ended = g.ev('gameEnded')[0];
    expect(ended?.data.roles).toEqual({ p1: 'mafia', p2: 'doctor', p3: 'civilian', p4: 'civilian', p5: 'civilian' });
    expect(ended?.visibility.all).toBe(true);
  });

  it('пока жив Маньяк, красные не победили, даже если мафии нет', () => {
    const g = new Sim(['mafia', 'maniac', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('mafia');
    g.tally();
    expect(g.state.phase).toBe('night');
    expect(g.state.result).toBeNull();

    g.night();
    g.voteAll('maniac');
    g.tally();
    expect(g.state.result?.outcome).toBe('red');
  });

  it('предсмертный выстрел Охотника учитывается до проверки победы', () => {
    // без выстрела остался бы один мафиози против одного мирного — победа чёрных
    const g = new Sim(['hunter', 'mafia', 'civilian']);
    g.mafia('mafia', 'hunter').night();
    expect(g.state.result).toBeNull();
    expect(g.state.phase).toBe('night');
    g.decide('hunter', { kind: 'hunterShot', target: 'mafia' });
    expect(g.state.result).toMatchObject({ outcome: 'red', winners: ['p1', 'p3'] });
  });

  it('угроз нет, а из живых только нейтрал — красные всё равно победили', () => {
    const g = new Sim(['mafia', 'survivor', 'hunter']);
    g.mafia('mafia', 'hunter').night();
    g.decide('hunter', { kind: 'hunterShot', target: 'mafia' });
    expect(g.state.result).toMatchObject({ outcome: 'red', winners: [g.id('survivor'), g.id('hunter')] });
  });
});

describe('Победа чёрных', () => {
  it('когда мафиози не меньше остальных (после ночи)', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'p2').night();
    expect(g.state.result).toBeNull();
    g.skipDay();
    g.mafia('mafia', 'p3').night();
    expect(g.state.result).toEqual({ outcome: 'black', reason: 'mafiaParity', winners: ['p1'] });
  });

  it('когда паритет наступил после дневной казни', () => {
    const g = new Sim(['mafia', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p3');
    g.tally();
    expect(g.state.result?.outcome).toBe('black');
    expect(g.state.result?.winners).toEqual(['p1', 'p2']);
  });

  it('побеждают и погибшие чёрные', () => {
    const g = new Sim(['mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'p3').mafia('don', 'p3').night();
    g.voteAll('don');
    g.tally();
    g.mafia('mafia', 'p4').night();
    g.skipDay();
    g.mafia('mafia', 'p5').night();
    expect(g.state.result?.outcome).toBe('black');
    expect(g.state.result?.winners).toEqual(['p1', 'p2']);
  });

  it('нейтральные считаются среди «остальных»', () => {
    const g = new Sim(['mafia', 'jester', 'survivor', 'civilian']);
    g.mafia('mafia', 'civilian').night();
    // 1 мафиози против Шута и Выжившего — игра продолжается
    expect(g.state.result).toBeNull();
  });
});

describe('Мафия и Маньяк', () => {
  it('пока жив Маньяк, паритета мафии мало — нужно строгое большинство', () => {
    const withManiac = new Sim(['mafia', 'mafia', 'maniac', 'civilian']);
    withManiac.night();
    expect(withManiac.state.result).toBeNull();
    expect(withManiac.state.phase).toBe('day');

    const withoutManiac = new Sim(['mafia', 'mafia', 'civilian', 'civilian']);
    withoutManiac.night();
    expect(withoutManiac.state.result?.outcome).toBe('black');
  });

  it('двое мафиози против одного Маньяка — победа чёрных', () => {
    const g = new Sim(['mafia', 'mafia', 'maniac']);
    g.night();
    expect(g.state.result).toMatchObject({ outcome: 'black', reason: 'mafiaParity' });
  });

  it('остались один мафиози и Маньяк — ничья', () => {
    const g = new Sim(['mafia', 'maniac', 'civilian']);
    g.mafia('mafia', 'civilian').night();
    expect(g.state.result).toEqual({ outcome: 'draw', reason: 'mafiaManiacStandoff', winners: [] });
  });

  it('мафиози и Маньяк убили друг друга, живых нет — ничья', () => {
    const g = new Sim(['mafia', 'maniac']);
    g.mafia('mafia', 'maniac').act('maniac', 'kill', 'mafia').night();
    expect(g.state.result).toEqual({ outcome: 'draw', reason: 'everyoneDead', winners: [] });
  });
});

describe('Победа Маньяка', () => {
  it('когда он остался вдвоём с одним игроком, а мафии нет', () => {
    const g = new Sim(['maniac', 'civilian', 'civilian']);
    g.act('maniac', 'kill', 'p2').night();
    expect(g.state.result).toEqual({ outcome: 'maniac', reason: 'maniacLastStanding', winners: ['p1'] });
  });

  it('когда он остался один', () => {
    const g = new Sim(['maniac', 'hunter', 'cupid']);
    g.act('cupid', 'link', 'hunter', 'cupid');
    g.act('maniac', 'kill', 'cupid');
    g.night();
    // Купидон убит, Охотник погиб от горя и не стал стрелять
    g.decide('hunter', { kind: 'hunterShot', target: null });
    expect(g.state.result).toMatchObject({ outcome: 'maniac', winners: ['p1'] });
  });

  it('втроём без мафии игра продолжается', () => {
    const g = new Sim(['maniac', 'civilian', 'civilian', 'civilian']);
    g.act('maniac', 'kill', 'p2').night();
    expect(g.state.result).toBeNull();
    expect(g.state.phase).toBe('day');
  });

  it('пока жива мафия, Маньяк не побеждает', () => {
    const g = new Sim(['maniac', 'mafia', 'civilian', 'civilian']);
    g.act('maniac', 'kill', 'p3').night();
    expect(g.state.result).toBeNull();
  });

  it('оставшийся с ним Выживший тоже побеждает', () => {
    const g = new Sim(['maniac', 'survivor', 'civilian']);
    g.act('maniac', 'kill', 'civilian').night();
    expect(g.state.result).toMatchObject({ outcome: 'maniac', winners: ['p1', 'p2'] });
  });
});

describe('Нейтральные и ничья', () => {
  it('нейтральная Любовница побеждает, если жива, красная — вместе с красными', () => {
    const roles = ['mistress', 'mafia', 'civilian', 'civilian'] as const;
    const neutral = new Sim([...roles]);
    neutral.mafia('mafia', 'p3').night();
    neutral.skipDay();
    neutral.mafia('mafia', 'p4').night();
    expect(neutral.state.result?.outcome).toBe('black');
    expect(neutral.state.result?.winners).toEqual(['p1', 'p2']);

    const red = new Sim([...roles], { rules: { mistressMode: 'red' } });
    red.mafia('mafia', 'p3').night();
    red.skipDay();
    red.mafia('mafia', 'p4').night();
    expect(red.state.result?.outcome).toBe('black');
    expect(red.state.result?.winners).toEqual(['p2']);
  });

  it('личная победа Шута сохраняется при ничьей', () => {
    const g = new Sim(['jester', 'mafia', 'maniac', 'civilian', 'civilian']);
    g.night();
    g.voteAll('jester');
    g.tally();
    g.mafia('mafia', 'p4').act('maniac', 'kill', 'p5').night();
    expect(g.state.result).toEqual({ outcome: 'draw', reason: 'mafiaManiacStandoff', winners: ['p1'] });
  });
});

describe('После конца игры', () => {
  it('никакие действия не принимаются', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('mafia');
    g.tally();
    expect(g.state.phase).toBe('ended');
    expect(() => g.mafia('mafia', 'p2')).toThrow(EngineError);
    expect(() => g.night()).toThrow(EngineError);
    expect(() => g.vote('p2', 'p3')).toThrow(EngineError);
    expect(() => g.tally()).toThrow(EngineError);
    expect(() => g.decide('p2', { kind: 'hunterShot', target: null })).toThrow(EngineError);
  });

  it('в конце всем открыты все роли', () => {
    const g = new Sim(['mafia', 'doctor', 'civilian', 'civilian'], { rules: { revealRoleOnDeath: false } });
    g.night();
    g.voteAll('mafia');
    g.tally();
    for (const viewer of ['p1', 'p2', 'p3', null]) {
      expect(g.view(viewer).players.map((p) => p.role)).toEqual(['mafia', 'doctor', 'civilian', 'civilian']);
    }
  });
});
