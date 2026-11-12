import { describe, expect, it } from 'vitest';
import { EngineError, currentDecision, nightOptions, resolvePendingDefault } from '../src/index';
import { Sim } from './helpers';

describe('Охотник', () => {
  it('убитый ночью, забирает с собой одного: игра ждёт его решения', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter');
    g.night();
    expect(g.alive('hunter')).toBe(false);
    // день ещё не начался: ждём выстрела
    expect(g.state.phase).toBe('night');
    expect(g.ev('dayStarted')).toHaveLength(0);
    const head = currentDecision(g.state);
    expect(head?.kind).toBe('hunterShot');
    expect(head?.playerId).toBe(g.id('hunter'));
    expect(head?.options).toEqual(['p2', 'p3', 'p4', 'p5', 'p6']);

    g.decide('hunter', { kind: 'hunterShot', target: 'p3' });
    expect(g.alive('p3')).toBe(false);
    expect(g.player('p3').death?.cause).toBe('hunterShot');
    expect(g.ev('death')[0]?.actors).toEqual([g.id('hunter')]);
    expect(g.state.phase).toBe('day');
    expect(g.state.pending).toEqual([]);
  });

  it('пока он не решил, действовать нельзя', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter');
    g.night();
    expect(() => g.vote('p3', 'p2')).toThrow(EngineError);
    expect(() => g.mafia('mafia', 'p3')).toThrow(EngineError);
    expect(() => g.night()).toThrow(EngineError);
    // решение принимает только сам Охотник и только своё
    expect(() => g.decide('p3', { kind: 'hunterShot', target: 'p2' })).toThrow(EngineError);
    expect(() => g.decide('hunter', { kind: 'judgeVeto', veto: true })).toThrow(EngineError);
  });

  it('может не стрелять', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter');
    g.night();
    g.decide('hunter', { kind: 'hunterShot', target: null });
    expect(g.ev('death')).toHaveLength(0);
    expect(g.state.phase).toBe('day');
  });

  it('по таймауту не стреляет', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter');
    g.night();
    const result = resolvePendingDefault(g.state);
    expect(result.state.phase).toBe('day');
    expect(result.state.players.filter((p) => !p.alive)).toHaveLength(1);
  });

  it('казнённый днём, тоже стреляет', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('hunter');
    g.tally();
    expect(g.alive('hunter')).toBe(false);
    expect(g.state.phase).toBe('day');
    expect(currentDecision(g.state)?.kind).toBe('hunterShot');

    g.decide('hunter', { kind: 'hunterShot', target: 'mafia' });
    expect(g.alive('mafia')).toBe(false);
    expect(g.state.result?.outcome).toBe('red');
  });

  it('не может стрелять в мёртвого и в себя', () => {
    const g = new Sim(['hunter', 'mafia', 'maniac', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter');
    g.act('maniac', 'kill', 'p4');
    g.night();
    expect(() => g.decide('hunter', { kind: 'hunterShot', target: 'p4' })).toThrow(EngineError);
    expect(() => g.decide('hunter', { kind: 'hunterShot', target: 'hunter' })).toThrow(EngineError);
  });
});

describe('Мэр', () => {
  it('его голос считается за два', () => {
    const g = new Sim(['mayor', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('mayor', 'mafia').vote('p3', 'mafia');
    g.vote('mafia', 'p3').vote('p4', 'p3');
    g.tally();
    const result = g.ev('voteResult')[0];
    expect(result?.data.tally).toEqual({ p2: 3, p3: 2 });
    expect(result?.data.outcome).toBe('condemned');
    expect(result?.data.abstained).toBe(2);
    expect(g.alive('mafia')).toBe(false);
  });

  it('те же голоса без Мэра дают ничью', () => {
    const g = new Sim(['civilian', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('p1', 'mafia').vote('p3', 'mafia');
    g.vote('mafia', 'p3').vote('p4', 'p3');
    g.tally();
    expect(g.ev('voteResult')[0]?.data.outcome).toBe('tie');
    expect(g.state.day?.stage).toBe('revote');
  });
});

describe('Судья', () => {
  it('может отменить итог голосования: приговорённый жив, наступает ночь', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p3');
    g.tally();
    // итог объявлен, но казни ещё не было: ждём Судью
    expect(g.ev('voteResult')[0]?.data.outcome).toBe('condemned');
    expect(g.alive('p3')).toBe(true);
    const head = currentDecision(g.state);
    expect(head).toMatchObject({ kind: 'judgeVeto', playerId: g.id('judge'), condemned: 'p3' });

    g.decide('judge', { kind: 'judgeVeto', veto: true });
    expect(g.alive('p3')).toBe(true);
    const cancelled = g.ev('voteCancelled')[0];
    expect(cancelled?.targets).toEqual(['p3']);
    // всем видно, что итог отменён, но не кто Судья
    expect(cancelled?.visibility.players).toEqual([g.id('judge')]);
    expect(cancelled?.stealth).toMatchObject({ actors: false, targets: true });
    expect(g.state.phase).toBe('night');
    expect(g.player('judge').vetoUsed).toBe(true);
  });

  it('отмена одноразовая: во второй раз его не спрашивают', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p3');
    g.tally();
    g.decide('judge', { kind: 'judgeVeto', veto: true });

    g.night();
    g.voteAll('p3');
    g.tally();
    expect(g.state.pending).toEqual([]);
    expect(g.alive('p3')).toBe(false);
  });

  it('если не отменяет, казнь состоится, а отмена остаётся', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p3');
    g.tally();
    g.decide('judge', { kind: 'judgeVeto', veto: false });
    expect(g.alive('p3')).toBe(false);
    expect(g.player('judge').vetoUsed).toBe(false);
    expect(g.state.phase).toBe('night');
  });

  it('по таймауту не отменяет', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p3');
    g.tally();
    const result = resolvePendingDefault(g.state);
    expect(result.state.players.find((p) => p.id === 'p3')?.alive).toBe(false);
  });

  it('может спасти и себя', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('judge');
    g.tally();
    g.decide('judge', { kind: 'judgeVeto', veto: true });
    expect(g.alive('judge')).toBe(true);
  });

  it('его не спрашивают, если казни и так не будет', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.skipDay();
    expect(g.state.pending).toEqual([]);
    expect(g.state.phase).toBe('night');
  });
});

describe('Купидон', () => {
  it('в первую ночь связывает двоих: погибает один — погибает и второй', () => {
    const g = new Sim(['cupid', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'p3', 'p4');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.state.lovers).toEqual([['p3', 'p4']]);
    expect(g.alive('p3')).toBe(false);
    expect(g.alive('p4')).toBe(false);
    expect(g.player('p4').death?.cause).toBe('loverGrief');
  });

  it('влюблённые узнают друг о друге, но не о Купидоне', () => {
    const g = new Sim(['cupid', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'p3', 'p4').night();
    const linked = g.ev('loversLinked')[0];
    expect(linked?.visibility.players).toEqual([g.id('cupid')]);
    expect(linked?.stealth).toMatchObject({ actors: false, targets: true });
    expect(linked?.stealth?.visibility.players).toEqual(['p3', 'p4']);

    expect(g.view('p3').you?.lovers).toEqual(['p4']);
    expect(g.view('p4').you?.lovers).toEqual(['p3']);
    expect(g.view('p5').you?.lovers).toEqual([]);
    const seen = g.view('p3').events.find((e) => e.type === 'loversLinked');
    expect(seen).toMatchObject({ redacted: true, actors: [], targets: ['p3', 'p4'] });
    expect(g.view('p5').events.some((e) => e.type === 'loversLinked')).toBe(false);
  });

  it('действует только в первую ночь', () => {
    const g = new Sim(['cupid', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.skipDay();
    expect(nightOptions(g.state, g.id('cupid'))?.abilities).toEqual([]);
    expect(() => g.act('cupid', 'link', 'p3', 'p4')).toThrow(EngineError);
  });

  it('казнь одного из влюблённых убивает и второго', () => {
    const g = new Sim(['cupid', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'p3', 'p4').night();
    g.voteAll('p3');
    g.tally();
    expect(g.alive('p3')).toBe(false);
    expect(g.alive('p4')).toBe(false);
    expect(g.ev('death').map((e) => e.data.cause)).toEqual(['execution', 'loverGrief']);
  });

  it('может связать себя с другим игроком', () => {
    const g = new Sim(['cupid', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'cupid', 'p3');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.alive('cupid')).toBe(false);
  });
});
