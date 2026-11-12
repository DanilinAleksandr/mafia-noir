import { describe, expect, it } from 'vitest';
import { EngineError, nightOptions } from '../src/index';
import { Sim } from './helpers';

describe('Доктор', () => {
  it('спасает от нападения мафии', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.ev('death')).toHaveLength(0);
    const saved = g.ev('saved')[0];
    expect(saved?.data).toEqual({ by: 'heal', attack: 'mafiaKill' });
    expect(saved?.actors).toEqual([g.id('doctor')]);
    expect(saved?.targets).toEqual(['p3']);
  });

  it('не помогает, если лечил не того', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p4');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(false);
    expect(g.ev('saved')).toHaveLength(0);
  });

  it('не может лечить одного и того же две ночи подряд, но через ночь — может', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p3').night();
    g.skipDay();

    const heal = nightOptions(g.state, g.id('doctor'))?.abilities.find((a) => a.id === 'heal');
    expect(heal?.candidates).not.toContain('p3');
    expect(() => g.act('doctor', 'heal', 'p3')).toThrow(EngineError);
    g.act('doctor', 'heal', 'p4').night();
    g.skipDay();

    expect(() => g.act('doctor', 'heal', 'p3')).not.toThrow();
  });

  it('может лечить себя по умолчанию и не может, если это выключено', () => {
    const roles = ['doctor', 'mafia', 'civilian', 'civilian', 'civilian'] as const;
    const a = new Sim([...roles]);
    a.act('doctor', 'heal', 'doctor');
    a.mafia('mafia', 'doctor');
    a.night();
    expect(a.alive('doctor')).toBe(true);

    const b = new Sim([...roles], { rules: { doctorSelfHeal: false } });
    expect(() => b.act('doctor', 'heal', 'doctor')).toThrow(EngineError);
  });

  it('убитый этой же ночью Доктор всё равно успевает вылечить', () => {
    const g = new Sim(['doctor', 'mafia', 'maniac', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p4');
    g.mafia('mafia', 'p4');
    g.act('maniac', 'kill', 'doctor');
    g.night();
    expect(g.alive('p4')).toBe(true);
    expect(g.alive('doctor')).toBe(false);
  });
});

describe('Телохранитель', () => {
  it('закрывает собой: подопечный жив, Телохранитель погибает', () => {
    const g = new Sim(['bodyguard', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('bodyguard', 'guard', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.alive('bodyguard')).toBe(false);
    expect(g.player('bodyguard').death?.cause).toBe('mafiaKill');
    expect(g.ev('saved')[0]?.data.by).toBe('guard');
    expect(g.ev('saved')[0]?.targets).toEqual(['p3']);
  });

  it('если Доктор лечит Телохранителя, выживают оба', () => {
    const g = new Sim(['bodyguard', 'mafia', 'civilian', 'doctor', 'civilian', 'civilian']);
    g.act('bodyguard', 'guard', 'p3');
    g.act('doctor', 'heal', 'bodyguard');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.alive('bodyguard')).toBe(true);
    expect(g.ev('saved').map((e) => e.data.by)).toEqual(['guard', 'heal']);
  });

  it('при двух нападениях на подопечного погибает один раз, подопечный жив', () => {
    const g = new Sim(['bodyguard', 'mafia', 'civilian', 'maniac', 'civilian', 'civilian', 'civilian']);
    g.act('bodyguard', 'guard', 'p3');
    g.mafia('mafia', 'p3');
    g.act('maniac', 'kill', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.ev('death').map((e) => e.targets[0])).toEqual([g.id('bodyguard')]);
  });

  it('не может охранять себя', () => {
    const g = new Sim(['bodyguard', 'mafia', 'civilian', 'civilian', 'civilian']);
    expect(() => g.act('bodyguard', 'guard', 'bodyguard')).toThrow(EngineError);
  });

  it('если никто не напал, ничего не происходит', () => {
    const g = new Sim(['bodyguard', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('bodyguard', 'guard', 'p3');
    g.mafia('mafia', 'p4');
    g.night();
    expect(g.alive('bodyguard')).toBe(true);
    expect(g.alive('p4')).toBe(false);
  });
});

describe('Священник', () => {
  it('защищённого нельзя казнить на следующий день', () => {
    const g = new Sim(['priest', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('priest', 'bless', 'p3').night();
    expect(g.ev('blessed')[0]?.visibility.players).toEqual([g.id('priest')]);

    g.voteAll('p3');
    g.tally();
    expect(g.alive('p3')).toBe(true);
    const prevented = g.ev('executionPrevented')[0];
    expect(prevented?.targets).toEqual(['p3']);
    expect(prevented?.data.reason).toBe('blessing');
    // всем видно, кого спасло благословение, но не кто Священник
    expect(prevented?.stealth).toMatchObject({ actors: false, targets: true });
    expect(g.state.phase).toBe('night');
    expect(g.state.round).toBe(2);
  });

  it('защита действует только один день', () => {
    const g = new Sim(['priest', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('priest', 'bless', 'p3').night();
    g.skipDay();
    g.night();
    g.voteAll('p3');
    g.tally();
    expect(g.alive('p3')).toBe(false);
  });

  it('не спасает от ночного нападения', () => {
    const g = new Sim(['priest', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('priest', 'bless', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(false);
  });

  it('не может защищать одного и того же две ночи подряд', () => {
    const g = new Sim(['priest', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('priest', 'bless', 'p3').night();
    g.skipDay();
    expect(() => g.act('priest', 'bless', 'p3')).toThrow(EngineError);
  });
});

describe('Герой', () => {
  it('переживает первое нападение, второе — нет', () => {
    const g = new Sim(['hero', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hero');
    g.night();
    expect(g.alive('hero')).toBe(true);
    expect(g.player('hero').armor).toBe(false);
    expect(g.ev('saved')[0]?.data.by).toBe('armor');
    expect(g.ev('saved')[0]?.visibility.players).toEqual([g.id('hero')]);

    g.skipDay();
    g.mafia('mafia', 'hero');
    g.night();
    expect(g.alive('hero')).toBe(false);
  });

  it('лечение Доктора бережёт щит', () => {
    const g = new Sim(['hero', 'mafia', 'doctor', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'hero');
    g.mafia('mafia', 'hero');
    g.night();
    expect(g.alive('hero')).toBe(true);
    expect(g.player('hero').armor).toBe(true);
  });

  it('щит не спасает от казни', () => {
    const g = new Sim(['hero', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('hero');
    g.tally();
    expect(g.alive('hero')).toBe(false);
  });
});

describe('Ведьма', () => {
  it('зелье спасения работает один раз за игру', () => {
    const g = new Sim(['witch', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('witch', 'potionHeal', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.ev('saved')[0]?.data.by).toBe('potion');

    g.skipDay();
    const abilities = nightOptions(g.state, g.id('witch'))?.abilities.map((a) => a.id);
    expect(abilities).toEqual(['potionKill']);
    expect(() => g.act('witch', 'potionHeal', 'p3')).toThrow(EngineError);
  });

  it('зелье спасения тратится, даже если на цель никто не напал', () => {
    const g = new Sim(['witch', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('witch', 'potionHeal', 'p3').night();
    expect(g.player('witch').uses.potionHeal).toBe(1);
  });

  it('зелье убийства убивает и тоже одноразовое', () => {
    const g = new Sim(['witch', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('witch', 'potionKill', 'mafia#1');
    expect(() => g.act('witch', 'potionKill', 'witch')).toThrow(EngineError);
    g.night();
    expect(g.alive('mafia')).toBe(false);
    expect(g.player('mafia').death?.cause).toBe('witchPoison');
    // мафии больше нет — красные победили
    expect(g.state.result?.outcome).toBe('red');
  });

  it('за ночь можно применить только одно зелье: второе действие заменяет первое', () => {
    const g = new Sim(['witch', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('witch', 'potionHeal', 'p3');
    g.act('witch', 'potionKill', 'p4');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(false);
    expect(g.alive('p4')).toBe(false);
    expect(g.player('witch').uses).toEqual({ potionKill: 1 });
  });

  it('яд можно вылечить', () => {
    const g = new Sim(['witch', 'mafia', 'civilian', 'doctor', 'civilian', 'civilian']);
    g.act('witch', 'potionKill', 'p3');
    g.act('doctor', 'heal', 'p3');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.ev('saved')[0]?.data).toEqual({ by: 'heal', attack: 'witchPoison' });
  });
});
