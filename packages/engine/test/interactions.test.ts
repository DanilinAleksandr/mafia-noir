import { describe, expect, it } from 'vitest';
import {
  EngineError,
  allNightActionsIn,
  allNightMovesDone,
  allVotesIn,
  currentDecision,
  nightMoveDone,
  pendingNightActors,
} from '../src/index';
import { Sim } from './helpers';

describe('Телохранитель и Купидон', () => {
  it('Телохранитель-влюблённый гибнет, закрыв подопечного, — и его пара гибнет от горя', () => {
    const g = new Sim(['cupid', 'bodyguard', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'bodyguard', 'p4');
    g.act('bodyguard', 'guard', 'p5');
    g.mafia('mafia', 'p5');
    g.night();
    expect(g.alive('p5')).toBe(true);
    expect(g.alive('bodyguard')).toBe(false);
    expect(g.alive('p4')).toBe(false);
    expect(g.ev('death').map((e) => [e.targets[0], e.data.cause])).toEqual([
      [g.id('bodyguard'), 'mafiaKill'],
      ['p4', 'loverGrief'],
    ]);
  });

  it('Телохранитель закрыл одного из влюблённых — живы оба влюблённых', () => {
    const g = new Sim(['cupid', 'bodyguard', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'p4', 'p5');
    g.act('bodyguard', 'guard', 'p4');
    g.mafia('mafia', 'p4');
    g.night();
    expect(g.alive('p4')).toBe(true);
    expect(g.alive('p5')).toBe(true);
    expect(g.alive('bodyguard')).toBe(false);
  });
});

describe('Цепочки смертей', () => {
  it('влюблённый Охотник гибнет от горя и стреляет; его жертва тянет за собой свою пару', () => {
    const g = new Sim(['cupid', 'cupid', 'hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid#1', 'link', 'hunter', 'p5');
    g.act('cupid#2', 'link', 'p6', 'p7');
    g.mafia('mafia', 'p5');
    g.night();
    expect(g.alive('p5')).toBe(false);
    expect(g.alive('hunter')).toBe(false);
    expect(g.player('hunter').death?.cause).toBe('loverGrief');
    expect(currentDecision(g.state)?.kind).toBe('hunterShot');

    g.decide('hunter', { kind: 'hunterShot', target: 'p6' });
    expect(g.alive('p6')).toBe(false);
    expect(g.alive('p7')).toBe(false);
    expect(g.ev('death').map((e) => e.data.cause)).toEqual(['hunterShot', 'loverGrief']);
    expect(g.state.phase).toBe('day');
  });

  it('Бомж ночует у влюблённого, чью пару убили: гибнут все трое', () => {
    const g = new Sim(['cupid', 'hobo', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('cupid', 'link', 'p4', 'p5');
    g.act('hobo', 'stay', 'p5');
    g.mafia('mafia', 'p4');
    g.night();
    expect(g.ev('death').map((e) => [e.targets[0], e.data.cause])).toEqual([
      ['p4', 'mafiaKill'],
      ['p5', 'loverGrief'],
      [g.id('hobo'), 'hoboWithHost'],
    ]);
  });

  it('два Охотника: первый стреляет во второго, второй стреляет в ответ', () => {
    const g = new Sim(['hunter', 'hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter#1');
    g.night();
    g.decide('hunter#1', { kind: 'hunterShot', target: 'hunter#2' });
    expect(g.alive('hunter#2')).toBe(false);
    expect(currentDecision(g.state)?.playerId).toBe(g.id('hunter#2'));
    g.decide('hunter#2', { kind: 'hunterShot', target: 'mafia' });
    expect(g.state.result?.outcome).toBe('red');
  });
});

describe('Охотник и Подрывник', () => {
  it('Подрывник забирает Охотника, Охотник забирает мафию', () => {
    const g = new Sim(['bomber', 'hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('hunter', 'bomber').vote('p4', 'bomber').vote('p5', 'bomber');
    g.tally();
    g.decide('bomber', { kind: 'bomberBlast', target: 'hunter' });
    expect(g.alive('hunter')).toBe(false);
    expect(g.state.phase).toBe('day');
    expect(currentDecision(g.state)?.kind).toBe('hunterShot');

    g.decide('hunter', { kind: 'hunterShot', target: 'mafia' });
    expect(g.alive('mafia')).toBe(false);
    expect(g.state.result?.outcome).toBe('red');
    // личная победа Подрывника сохраняется
    expect(g.state.result?.winners).toContain(g.id('bomber'));
  });

  it('казнённый Охотник стреляет в Подрывника: это не казнь, взрыва и победы нет', () => {
    const g = new Sim(['bomber', 'hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('hunter');
    g.tally();
    g.decide('hunter', { kind: 'hunterShot', target: 'bomber' });
    expect(g.alive('bomber')).toBe(false);
    expect(g.state.pending).toEqual([]);
    expect(g.state.personalWinners).toEqual([]);
    expect(g.state.phase).toBe('night');
  });

  it('щит Героя поглощает выстрел Охотника', () => {
    const g = new Sim(['hunter', 'hero', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hunter');
    g.night();
    g.decide('hunter', { kind: 'hunterShot', target: 'hero' });
    expect(g.alive('hero')).toBe(true);
    expect(g.player('hero').armor).toBe(false);
    expect(g.ev('saved')[0]?.data).toEqual({ by: 'armor', attack: 'hunterShot' });
  });
});

describe('Священник, Судья и казнь', () => {
  it('благословлённого Шута не казнят — и он не побеждает', () => {
    const g = new Sim(['priest', 'jester', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('priest', 'bless', 'jester').night();
    g.voteAll('jester');
    g.tally();
    expect(g.alive('jester')).toBe(true);
    expect(g.state.personalWinners).toEqual([]);
  });

  it('Судью не спрашивают, если приговорённого и так защитил Священник', () => {
    const g = new Sim(['priest', 'judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('priest', 'bless', 'p4').night();
    g.voteAll('p4');
    g.tally();
    expect(g.ev('executionPrevented')).toHaveLength(1);
    expect(g.state.pending).toEqual([]);
    expect(g.player('judge').vetoUsed).toBe(false);
  });

  it('Судья отменил казнь Подрывника: взрыва нет, победы нет', () => {
    const g = new Sim(['judge', 'bomber', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('bomber');
    g.tally();
    g.decide('judge', { kind: 'judgeVeto', veto: true });
    expect(g.alive('bomber')).toBe(true);
    expect(g.state.pending).toEqual([]);
    expect(g.state.personalWinners).toEqual([]);
  });

  it('два Судьи решают по очереди; после отказа обоих казнь состоится', () => {
    const g = new Sim(['judge', 'judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p4');
    g.tally();
    expect(currentDecision(g.state)?.playerId).toBe(g.id('judge#1'));
    g.decide('judge#1', { kind: 'judgeVeto', veto: false });
    expect(g.alive('p4')).toBe(true);
    expect(currentDecision(g.state)?.playerId).toBe(g.id('judge#2'));
    g.decide('judge#2', { kind: 'judgeVeto', veto: false });
    expect(g.alive('p4')).toBe(false);
  });

  it('если первый Судья отменил, второго не спрашивают', () => {
    const g = new Sim(['judge', 'judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p4');
    g.tally();
    g.decide('judge#1', { kind: 'judgeVeto', veto: true });
    expect(g.state.pending).toEqual([]);
    expect(g.state.phase).toBe('night');
    expect(g.player('judge#2').vetoUsed).toBe(false);
  });
});

describe('Одновременные нападения и защиты', () => {
  it('Доктор спасает от двух нападений сразу', () => {
    const g = new Sim(['doctor', 'mafia', 'maniac', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p4');
    g.mafia('mafia', 'p4');
    g.act('maniac', 'kill', 'p4');
    g.night();
    expect(g.alive('p4')).toBe(true);
    expect(g.ev('saved').map((e) => e.data.attack)).toEqual(['mafiaKill', 'maniacKill']);
  });

  it('щит Героя держит одно нападение, второе той же ночью убивает', () => {
    const g = new Sim(['hero', 'mafia', 'maniac', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'hero');
    g.act('maniac', 'kill', 'hero');
    g.night();
    expect(g.alive('hero')).toBe(false);
    expect(g.player('hero').death?.cause).toBe('maniacKill');
  });

  it('убитый этой ночью Комиссар всё равно получает результат проверки', () => {
    const g = new Sim(['commissioner', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('commissioner', 'check', 'mafia');
    g.mafia('mafia', 'commissioner');
    g.night();
    expect(g.alive('commissioner')).toBe(false);
    expect(g.ev('checked')[0]?.data.isMafia).toBe(true);
  });

  it('по правилу «не объявлять спасения» у события «спасён» нет скрытного вида', () => {
    const roles = ['doctor', 'mafia', 'civilian', 'civilian', 'civilian'] as const;
    const announced = new Sim([...roles]);
    announced.act('doctor', 'heal', 'p3').mafia('mafia', 'p3').night();
    expect(announced.ev('saved')[0]?.stealth).toEqual({
      visibility: { all: true, teams: [], players: [] },
      actors: false,
      targets: false,
      data: [],
    });
    // остальные видят только сам факт: кого-то спасли
    const seen = announced.view('p4').events.find((e) => e.type === 'saved');
    expect(seen).toMatchObject({ redacted: true, actors: [], targets: [], data: {} });

    const quiet = new Sim([...roles], { rules: { announceSaves: false } });
    quiet.act('doctor', 'heal', 'p3').mafia('mafia', 'p3').night();
    expect(quiet.ev('saved')[0]?.stealth).toBeNull();
    expect(quiet.view('p4').events.some((e) => e.type === 'saved')).toBe(false);
  });
});

describe('Голосование', () => {
  it('ничья → переголосование среди набравших поровну → снова ничья → никто не уходит', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('p1', 'p2').vote('p3', 'p2');
    g.vote('p2', 'p3').vote('p4', 'p3');
    g.tally();
    expect(g.ev('voteResult')[0]?.data).toMatchObject({ stage: 'vote', outcome: 'tie' });
    expect(g.ev('revoteStarted')[0]?.targets).toEqual(['p2', 'p3']);
    expect(g.state.day).toMatchObject({ stage: 'revote', candidates: ['p2', 'p3'], votes: {} });
    expect(g.state.phase).toBe('day');

    // при переголосовании можно выбирать только из кандидатов
    expect(() => g.vote('p1', 'p5')).toThrow(EngineError);
    g.vote('p1', 'p2').vote('p4', 'p3');
    g.tally();
    expect(g.ev('voteResult')[0]?.data).toMatchObject({ stage: 'revote', outcome: 'tie' });
    expect(g.ev('noExecution')[0]?.data.reason).toBe('tie');
    expect(g.state.players.every((p) => p.alive)).toBe(true);
    expect(g.state.phase).toBe('night');
    expect(g.state.round).toBe(2);
  });

  it('переголосование может закончиться казнью', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('p1', 'p2').vote('p2', 'p3');
    g.tally();
    g.vote('p1', 'p2').vote('p4', 'p2').vote('p5', 'p3');
    g.tally();
    expect(g.alive('p2')).toBe(false);
  });

  it('если никто не голосовал, никто не уходит', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.tally();
    expect(g.ev('voteResult')[0]?.data).toMatchObject({ outcome: 'noVotes', abstained: 5, tally: {} });
    expect(g.ev('noExecution')[0]?.data.reason).toBe('noVotes');
    expect(g.state.phase).toBe('night');
  });

  it('нельзя голосовать против себя, против мёртвого, мёртвому и ночью', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    expect(() => g.vote('p2', 'p3')).toThrow(EngineError);
    g.mafia('mafia', 'p5').night();
    expect(() => g.vote('p2', 'p2')).toThrow(EngineError);
    expect(() => g.vote('p2', 'p5')).toThrow(EngineError);
    expect(() => g.vote('p5', 'p2')).toThrow(EngineError);
    expect(() => g.vote('p2', 'p99')).toThrow(EngineError);
  });

  it('голос можно менять до подсчёта; allVotesIn отслеживает готовность', () => {
    const g = new Sim(['mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    expect(allVotesIn(g.state)).toBe(false);
    g.vote('p1', 'p2').vote('p2', 'p1').vote('p3', 'p2');
    expect(allVotesIn(g.state)).toBe(false);
    g.vote('p4', null);
    expect(allVotesIn(g.state)).toBe(true);
    g.vote('p3', 'p1').vote('p4', 'p1');
    g.tally();
    expect(g.alive('p1')).toBe(false);
    expect(g.state.result?.outcome).toBe('red');
  });
});

describe('Готовность ночи', () => {
  it('allNightActionsIn ждёт способности (или отказа) и голоса мафии', () => {
    const g = new Sim(['doctor', 'lawyer', 'commissioner', 'civilian', 'civilian', 'civilian']);
    expect(allNightActionsIn(g.state)).toBe(false);
    expect(pendingNightActors(g.state)).toEqual(['p1', 'p2', 'p3']);

    g.act('doctor', 'heal', 'p4');
    g.pass('commissioner');
    expect(pendingNightActors(g.state)).toEqual(['p2']);

    // Адвокату нужно и применить способность, и проголосовать
    g.act('lawyer', 'cover', 'lawyer');
    expect(allNightActionsIn(g.state)).toBe(false);
    g.mafia('lawyer', 'p4');
    expect(allNightActionsIn(g.state)).toBe(true);
  });

  it('действие можно менять до разрешения ночи', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p3').act('doctor', 'heal', 'p4');
    g.mafia('mafia', 'p3').mafia('mafia', 'p4');
    g.night();
    expect(g.ev('death')).toHaveLength(0);
    expect(g.ev('saved')[0]?.targets).toEqual(['p4']);
  });

  it('ночь разрешается и без ответов: молчание считается отказом', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    expect(g.state.phase).toBe('day');
    expect(g.state.players.every((p) => p.alive)).toBe(true);
  });
});

describe('«Пустой» ночной ход', () => {
  it('nightMoveDone считает ходом и отказ того, кому делать нечего', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian']);
    expect(nightMoveDone(g.state, 'p3')).toBe(false);
    expect(allNightMovesDone(g.state)).toBe(false);
    // обычная готовность движка «пустых» ходов не ждёт
    g.act('doctor', 'heal', 'p3').mafia('mafia', 'p4');
    expect(allNightActionsIn(g.state)).toBe(true);
    expect(allNightMovesDone(g.state)).toBe(false);

    g.pass('p3');
    expect(nightMoveDone(g.state, 'p3')).toBe(true);
    g.pass('p4');
    expect(allNightMovesDone(g.state)).toBe(true);
  });

  it('мёртвых не ждут, а после разрешения ночи ходов нет', () => {
    const g = new Sim(['doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'p5').night();
    expect(nightMoveDone(g.state, 'p1')).toBe(false);
    g.skipDay();
    for (const id of ['p1', 'p3', 'p4']) g.pass(id);
    g.mafia('mafia', null);
    expect(allNightMovesDone(g.state)).toBe(true);
    expect(nightMoveDone(g.state, 'p5')).toBe(false);
  });
});
