import { describe, expect, it } from 'vitest';
import { EngineError, nightOptions } from '../src/index';
import { Sim } from './helpers';

describe('Мафия: выбор жертвы', () => {
  it('жертва выбирается большинством голосов мафиози', () => {
    const g = new Sim(['mafia', 'mafia', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia#1', 'p4').mafia('mafia#2', 'p4').mafia('mafia#3', 'p5');
    g.night();
    expect(g.alive('p4')).toBe(false);
    expect(g.alive('p5')).toBe(true);
    const chosen = g.ev('mafiaTargetChosen')[0];
    expect(chosen?.targets).toEqual(['p4']);
    expect(chosen?.data.decidedBy).toBe('votes');
    expect(chosen?.data.votes).toEqual({ p1: 'p4', p2: 'p4', p3: 'p5' });
    expect(chosen?.visibility).toEqual({ all: false, teams: ['black'], players: [] });
    // исполнитель — один из голосовавших за жертву
    expect(['p1', 'p2']).toContain(chosen?.actors[0]);
  });

  it('при равенстве решает Дон', () => {
    const g = new Sim(['mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'p3').mafia('don', 'p4');
    g.night();
    expect(g.alive('p3')).toBe(true);
    expect(g.alive('p4')).toBe(false);
    expect(g.ev('mafiaTargetChosen')[0]?.data.decidedBy).toBe('don');
  });

  it('без Дона при равенстве жертва выбирается случайно среди равных, но воспроизводимо', () => {
    const play = (seed: string) => {
      const g = new Sim(['mafia', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian'], { seed });
      g.mafia('mafia#1', 'p3').mafia('mafia#2', 'p4');
      g.night();
      expect(g.ev('mafiaTargetChosen')[0]?.data.decidedBy).toBe('random');
      const dead = g.state.players.filter((p) => !p.alive).map((p) => p.id);
      expect(dead).toHaveLength(1);
      expect(['p3', 'p4']).toContain(dead[0]);
      return dead[0];
    };
    expect(play('a')).toBe(play('a'));
    const outcomes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(play));
    expect(outcomes.size).toBe(2);
  });

  it('если Дон мёртв, равенство решается случайно', () => {
    const g = new Sim(['mafia', 'mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('don');
    g.tally();
    g.mafia('mafia#1', 'p4').mafia('mafia#2', 'p5');
    g.night();
    expect(g.ev('mafiaTargetChosen')[0]?.data.decidedBy).toBe('random');
  });

  it('если никто из мафии не проголосовал, никто не погибает', () => {
    const g = new Sim(['mafia', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia#1', null);
    g.night();
    expect(g.ev('death')).toHaveLength(0);
    expect(g.ev('mafiaTargetChosen')).toHaveLength(0);
  });

  it('нельзя голосовать за своих, мёртвых и не будучи чёрным', () => {
    const g = new Sim(['mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian']);
    expect(() => g.mafia('mafia', 'don')).toThrow(EngineError);
    expect(() => g.mafia('mafia', 'mafia')).toThrow(EngineError);
    expect(() => g.mafia('p3', 'p4')).toThrow(EngineError);
    expect(nightOptions(g.state, 'p3')?.mafiaVote).toBeNull();
  });

  it('все чёрные роли участвуют в голосовании', () => {
    const g = new Sim(['lawyer', 'blackmailer', 'consigliere', 'commissioner', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('lawyer', 'p5').mafia('blackmailer', 'p5').mafia('consigliere', 'p6');
    g.night();
    expect(g.alive('p5')).toBe(false);
  });
});

describe('Адвокат', () => {
  it('прикрытый мафиози выглядит для Комиссара как не мафия — но только этой ночью', () => {
    const g = new Sim(['lawyer', 'mafia', 'commissioner', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('lawyer', 'cover', 'mafia');
    g.act('commissioner', 'check', 'mafia');
    g.night();
    expect(g.ev('checked')[0]?.data.isMafia).toBe(false);
    expect(g.ev('covered')[0]?.visibility.teams).toEqual(['black']);

    g.skipDay();
    g.act('commissioner', 'check', 'mafia');
    g.night();
    expect(g.ev('checked')[0]?.data.isMafia).toBe(true);
  });

  it('может прикрыть себя', () => {
    const g = new Sim(['lawyer', 'mafia', 'commissioner', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('lawyer', 'cover', 'lawyer');
    g.act('commissioner', 'check', 'lawyer');
    g.night();
    expect(g.ev('checked')[0]?.data.isMafia).toBe(false);
  });

  it('прикрытие не действует на других мафиози', () => {
    const g = new Sim(['lawyer', 'mafia', 'commissioner', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('lawyer', 'cover', 'lawyer');
    g.act('commissioner', 'check', 'mafia');
    g.night();
    expect(g.ev('checked')[0]?.data.isMafia).toBe(true);
  });

  it('может прикрывать только чёрных', () => {
    const g = new Sim(['lawyer', 'mafia', 'commissioner', 'civilian', 'civilian', 'civilian', 'civilian']);
    expect(() => g.act('lawyer', 'cover', 'civilian')).toThrow(EngineError);
  });
});

describe('Шантажист', () => {
  it('выбранный игрок молчит на следующем обсуждении, и это видят все', () => {
    const g = new Sim(['blackmailer', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('blackmailer', 'silence', 'p3').night();
    expect(g.state.day?.silenced).toEqual(['p3']);

    const silenced = g.ev('silenced')[0];
    expect(silenced?.visibility.teams).toEqual(['black']);
    expect(silenced?.stealth).toMatchObject({ actors: false, targets: true });
    expect(silenced?.stealth?.visibility.all).toBe(true);

    expect(g.view('p3').you?.silenced).toBe(true);
    expect(g.view('p4').players.find((p) => p.id === 'p3')?.silenced).toBe(true);
    const seen = g.view('p4').events.find((e) => e.type === 'silenced');
    expect(seen).toMatchObject({ redacted: true, actors: [], targets: ['p3'] });
  });

  it('молчащий может голосовать, а на следующий день запрет снят', () => {
    const g = new Sim(['blackmailer', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('blackmailer', 'silence', 'p3').night();
    expect(() => g.vote('p3', 'p2')).not.toThrow();
    g.tally();
    g.night();
    expect(g.state.day?.silenced).toEqual([]);
    expect(g.view('p3').you?.silenced).toBe(false);
  });

  it('не может затыкать одного и того же две ночи подряд', () => {
    const g = new Sim(['blackmailer', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('blackmailer', 'silence', 'p3').night();
    g.skipDay();
    expect(() => g.act('blackmailer', 'silence', 'p3')).toThrow(EngineError);
  });

  it('если цель погибла этой ночью, объявления о молчании нет', () => {
    const g = new Sim(['blackmailer', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('blackmailer', 'silence', 'p3');
    g.mafia('blackmailer', 'p3');
    g.night();
    expect(g.ev('silenced')[0]?.stealth).toBeNull();
    expect(g.state.day?.silenced).toEqual([]);
  });
});

describe('Консильери', () => {
  it('узнаёт точную роль, и результат видит вся чёрная команда', () => {
    const g = new Sim(['consigliere', 'mafia', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('consigliere', 'scout', 'doctor').night();
    const learned = g.ev('roleLearned')[0];
    expect(learned?.data.role).toBe('doctor');
    expect(learned?.visibility.teams).toEqual(['black']);

    const doctor = g.id('doctor');
    expect(g.view('mafia').players.find((p) => p.id === doctor)?.role).toBe('doctor');
    expect(g.view('civilian').players.find((p) => p.id === doctor)?.role).toBeNull();
  });

  it('может узнавать роли каждую ночь, но не своих', () => {
    const g = new Sim(['consigliere', 'mafia', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('consigliere', 'scout', 'doctor').night();
    g.skipDay();
    expect(() => g.act('consigliere', 'scout', 'civilian')).not.toThrow();
    expect(() => g.act('consigliere', 'scout', 'mafia')).toThrow(EngineError);
  });
});
