import { describe, expect, it } from 'vitest';
import { EngineError, nightOptions } from '../src/index';
import { Sim } from './helpers';

describe('Комиссар', () => {
  it('видит мафию как мафию, а мирного как не мафию', () => {
    const g = new Sim(['commissioner', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('commissioner', 'check', 'mafia').night();
    expect(g.ev('checked')).toHaveLength(1);
    expect(g.ev('checked')[0]?.data.isMafia).toBe(true);
    expect(g.ev('checked')[0]?.targets).toEqual([g.id('mafia')]);

    g.skipDay();
    g.act('commissioner', 'check', 'civilian').night();
    expect(g.ev('checked')[0]?.data.isMafia).toBe(false);
  });

  it('результат виден только самому Комиссару и не имеет скрытного вида', () => {
    const g = new Sim(['commissioner', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('commissioner', 'check', 'mafia').night();
    const event = g.ev('checked')[0];
    expect(event?.visibility).toEqual({ all: false, teams: [], players: [g.id('commissioner')] });
    expect(event?.stealth).toBeNull();
  });

  it('остальных чёрных видит как мафию, нейтральных — как не мафию', () => {
    const g = new Sim(['commissioner', 'lawyer', 'blackmailer', 'consigliere', 'jester', 'civilian', 'civilian', 'civilian', 'civilian']);
    const expected: [string, boolean][] = [
      ['lawyer', true],
      ['blackmailer', true],
      ['consigliere', true],
      ['jester', false],
    ];
    for (const [role, isMafia] of expected) {
      g.act('commissioner', 'check', role).night();
      expect(g.ev('checked')[0]?.data.isMafia, role).toBe(isMafia);
      g.skipDay();
    }
  });

  it('Дон: по умолчанию мафия, по правилу — не мафия', () => {
    const roles = ['commissioner', 'don', 'civilian', 'civilian', 'civilian'] as const;
    const a = new Sim([...roles]);
    a.act('commissioner', 'check', 'don').night();
    expect(a.ev('checked')[0]?.data.isMafia).toBe(true);

    const b = new Sim([...roles], { rules: { commissionerSeesDonAsMafia: false } });
    b.act('commissioner', 'check', 'don').night();
    expect(b.ev('checked')[0]?.data.isMafia).toBe(false);
  });

  it('Маньяк: по умолчанию не мафия, по правилу — мафия', () => {
    const roles = ['commissioner', 'mafia', 'maniac', 'civilian', 'civilian', 'civilian'] as const;
    const a = new Sim([...roles]);
    a.act('commissioner', 'check', 'maniac').night();
    expect(a.ev('checked')[0]?.data.isMafia).toBe(false);

    const b = new Sim([...roles], { rules: { commissionerSeesManiacAsMafia: true } });
    b.act('commissioner', 'check', 'maniac').night();
    expect(b.ev('checked')[0]?.data.isMafia).toBe(true);
  });

  it('не может проверить себя и мёртвого', () => {
    const g = new Sim(['commissioner', 'mafia', 'civilian', 'civilian', 'civilian']);
    expect(() => g.act('commissioner', 'check', 'commissioner')).toThrow(EngineError);
    g.mafia('mafia', 'p3').night();
    g.skipDay();
    expect(() => g.act('commissioner', 'check', 'p3')).toThrow(EngineError);
  });
});

describe('Следователь', () => {
  it('узнаёт точную роль, но только один раз за игру', () => {
    const g = new Sim(['detective', 'don', 'civilian', 'civilian', 'civilian']);
    g.act('detective', 'investigate', 'don').night();
    expect(g.ev('roleLearned')[0]?.data.role).toBe('don');
    expect(g.ev('roleLearned')[0]?.visibility.players).toEqual([g.id('detective')]);

    g.skipDay();
    expect(nightOptions(g.state, g.id('detective'))?.abilities).toEqual([]);
    expect(() => g.act('detective', 'investigate', 'civilian')).toThrow(EngineError);
  });

  it('узнанная роль появляется в его представлении и не появляется у других', () => {
    const g = new Sim(['detective', 'don', 'civilian', 'civilian', 'civilian']);
    g.act('detective', 'investigate', 'don').night();
    const don = g.id('don');
    expect(g.view('detective').players.find((p) => p.id === don)?.role).toBe('don');
    expect(g.view('civilian').players.find((p) => p.id === don)?.role).toBeNull();
  });
});

describe('Патрульный', () => {
  it('видит всех, кто приходил к игроку этой ночью, по порядку мест', () => {
    const g = new Sim(['patrol', 'doctor', 'mafia', 'civilian', 'civilian', 'commissioner']);
    g.act('patrol', 'watch', 'p4');
    g.act('doctor', 'heal', 'p4');
    g.mafia('mafia', 'p4');
    g.act('commissioner', 'check', 'p4');
    g.night();
    expect(g.ev('visitorsSeen')).toHaveLength(1);
    expect(g.ev('visitorsSeen')[0]?.data.visitors).toEqual(['p2', 'p3', 'p6']);
    expect(g.ev('visitorsSeen')[0]?.visibility.players).toEqual([g.id('patrol')]);
  });

  it('никого не видит, если никто не приходил', () => {
    const g = new Sim(['patrol', 'doctor', 'mafia', 'civilian', 'civilian']);
    g.act('patrol', 'watch', 'p4');
    g.act('doctor', 'heal', 'p5');
    g.night();
    expect(g.ev('visitorsSeen')[0]?.data.visitors).toEqual([]);
  });

  it('его наблюдение — не визит: Бомж его не видит, а он Бомжа видит', () => {
    const g = new Sim(['patrol', 'hobo', 'mafia', 'civilian', 'civilian']);
    g.act('patrol', 'watch', 'p4');
    g.act('hobo', 'stay', 'p4');
    g.night();
    const byActor = Object.fromEntries(g.ev('visitorsSeen').map((e) => [e.actors[0], e.data.visitors]));
    expect(byActor[g.id('patrol')]).toEqual([g.id('hobo')]);
    expect(byActor[g.id('hobo')]).toEqual([]);
  });
});

describe('Журналист', () => {
  it('сравнивает команды двух игроков', () => {
    const g = new Sim(['journalist', 'mafia', 'don', 'civilian', 'doctor', 'maniac', 'jester', 'civilian']);
    const cases: [string, string, boolean][] = [
      ['mafia', 'don', true],
      ['civilian', 'doctor', true],
      ['mafia', 'civilian', false],
      ['civilian', 'jester', false],
      // нейтральные — каждый сам за себя
      ['maniac', 'jester', false],
    ];
    for (const [a, b, same] of cases) {
      g.act('journalist', 'compare', a, b).night();
      expect(g.ev('teamsCompared')[0]?.data.sameTeam, `${a} и ${b}`).toBe(same);
      expect(g.ev('teamsCompared')[0]?.targets).toEqual([g.id(a), g.id(b)]);
      g.skipDay();
    }
  });

  it('должен выбрать двух разных игроков', () => {
    const g = new Sim(['journalist', 'mafia', 'civilian', 'civilian', 'civilian']);
    expect(() => g.act('journalist', 'compare', 'mafia')).toThrow(EngineError);
    expect(() => g.act('journalist', 'compare', 'mafia', 'mafia')).toThrow(EngineError);
  });
});

describe('Бомж', () => {
  it('видит гостей хозяина и погибает вместе с ним', () => {
    const g = new Sim(['hobo', 'mafia', 'civilian', 'civilian', 'civilian', 'doctor']);
    g.act('hobo', 'stay', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.ev('visitorsSeen')[0]?.data.visitors).toEqual([g.id('mafia')]);
    expect(g.alive('p3')).toBe(false);
    expect(g.alive('hobo')).toBe(false);
    expect(g.player('p3').death?.cause).toBe('mafiaKill');
    expect(g.player('hobo').death?.cause).toBe('hoboWithHost');
  });

  it('выживает, если хозяина спасли', () => {
    const g = new Sim(['hobo', 'mafia', 'civilian', 'civilian', 'civilian', 'doctor']);
    g.act('hobo', 'stay', 'p3');
    g.act('doctor', 'heal', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.alive('hobo')).toBe(true);
    expect(g.ev('visitorsSeen')[0]?.data.visitors).toEqual([g.id('mafia'), g.id('doctor')]);
  });

  it('не погибает, если остался дома, а соседа убили', () => {
    const g = new Sim(['hobo', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(false);
    expect(g.alive('hobo')).toBe(true);
  });
});
