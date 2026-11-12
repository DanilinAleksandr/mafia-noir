import { describe, expect, it } from 'vitest';
import { EngineError, currentDecision, resolvePendingDefault } from '../src/index';
import { Sim } from './helpers';

describe('Маньяк', () => {
  it('убивает каждую ночь', () => {
    const g = new Sim(['maniac', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('maniac', 'kill', 'p3').night();
    expect(g.alive('p3')).toBe(false);
    expect(g.player('p3').death?.cause).toBe('maniacKill');
    g.skipDay();
    g.act('maniac', 'kill', 'p4').night();
    expect(g.alive('p4')).toBe(false);
  });

  it('кто убил, знает только он; остальные видят жертву и причину', () => {
    const g = new Sim(['maniac', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('maniac', 'kill', 'p3').night();
    const death = g.ev('death')[0];
    expect(death?.actors).toEqual([g.id('maniac')]);
    expect(death?.visibility).toEqual({ all: false, teams: [], players: [g.id('maniac')] });

    const seen = g.view('p4').events.find((e) => e.type === 'death');
    expect(seen).toMatchObject({ redacted: true, actors: [], targets: ['p3'], data: { cause: 'maniacKill' } });
  });

  it('может убить мафиози, а мафия — его: нападения одновременны', () => {
    const g = new Sim(['maniac', 'mafia', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('maniac', 'kill', 'mafia#1');
    g.mafia('mafia#1', 'maniac').mafia('mafia#2', 'maniac');
    g.night();
    expect(g.alive('maniac')).toBe(false);
    expect(g.alive('mafia#1')).toBe(false);
    expect(g.alive('mafia#2')).toBe(true);
  });

  it('не может убить себя', () => {
    const g = new Sim(['maniac', 'mafia', 'civilian', 'civilian', 'civilian']);
    expect(() => g.act('maniac', 'kill', 'maniac')).toThrow(EngineError);
  });
});

describe('Любовница', () => {
  it('блокирует способность: Доктор не лечит, а запрет «два раза подряд» не срабатывает', () => {
    const g = new Sim(['mistress', 'doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'doctor');
    g.act('doctor', 'heal', 'p4');
    g.mafia('mafia', 'p4');
    g.night();
    expect(g.alive('p4')).toBe(false);
    expect(g.ev('saved')).toHaveLength(0);
    expect(g.state.night).toBeNull();

    const blocked = g.ev('blocked')[0];
    expect(blocked?.actors).toEqual([g.id('mistress')]);
    expect(blocked?.targets).toEqual([g.id('doctor')]);
    // заблокированный узнаёт о блокировке, но не о том, кто его заблокировал
    const seen = g.view('doctor').events.find((e) => e.type === 'blocked');
    expect(seen).toMatchObject({ redacted: true, actors: [], targets: [g.id('doctor')] });
    expect(g.view('p5').events.some((e) => e.type === 'blocked')).toBe(false);

    // лечение не состоялось — значит, следующей ночью ту же цель лечить можно (будь она жива)
    expect(g.player('doctor').last.heal).toBeUndefined();
  });

  it('заблокированный мафиози не голосует: единственная мафия никого не убивает', () => {
    const g = new Sim(['mistress', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'mafia');
    g.mafia('mafia', 'p3');
    g.night();
    expect(g.ev('death')).toHaveLength(0);
    expect(g.ev('mafiaTargetChosen')).toHaveLength(0);
  });

  it('при двух мафиози блокировка одного меняет исход голосования', () => {
    const g = new Sim(['mistress', 'mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'don');
    g.mafia('mafia', 'p4').mafia('don', 'p5');
    g.night();
    expect(g.alive('p4')).toBe(false);
    expect(g.alive('p5')).toBe(true);
    expect(g.ev('mafiaTargetChosen')[0]?.data.decidedBy).toBe('votes');
  });

  it('блокирует Маньяка', () => {
    const g = new Sim(['mistress', 'maniac', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'maniac');
    g.act('maniac', 'kill', 'p4');
    g.night();
    expect(g.alive('p4')).toBe(true);
  });

  it('заблокированный Следователь не тратит единственную попытку', () => {
    const g = new Sim(['mistress', 'detective', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'detective');
    g.act('detective', 'investigate', 'mafia');
    g.night();
    expect(g.ev('roleLearned')).toHaveLength(0);
    expect(g.player('detective').uses.investigate).toBeUndefined();
    g.skipDay();
    g.act('detective', 'investigate', 'mafia').night();
    expect(g.ev('roleLearned')[0]?.data.role).toBe('mafia');
  });

  it('заблокированный Охотник, убитый той же ночью, не стреляет', () => {
    const g = new Sim(['mistress', 'hunter', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'hunter');
    g.mafia('mafia', 'hunter');
    g.night();
    expect(g.alive('hunter')).toBe(false);
    expect(g.state.pending).toEqual([]);
    expect(g.state.phase).toBe('day');
  });

  it('её приход видит Патрульный', () => {
    const g = new Sim(['mistress', 'patrol', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'p4');
    g.act('patrol', 'watch', 'p4');
    g.night();
    expect(g.ev('visitorsSeen')[0]?.data.visitors).toEqual([g.id('mistress')]);
  });

  it('не может блокировать себя и одного и того же две ночи подряд', () => {
    const g = new Sim(['mistress', 'doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    expect(() => g.act('mistress', 'block', 'mistress')).toThrow(EngineError);
    g.act('mistress', 'block', 'doctor').night();
    g.skipDay();
    expect(() => g.act('mistress', 'block', 'doctor')).toThrow(EngineError);
    expect(() => g.act('mistress', 'block', 'mafia')).not.toThrow();
  });

  it('в красном режиме играет за красных, в нейтральном — сама за себя', () => {
    const roles = ['mistress', 'mafia', 'civilian', 'civilian', 'civilian'] as const;
    const red = new Sim([...roles], { rules: { mistressMode: 'red' } });
    expect(red.player('mistress').team).toBe('red');
    const neutral = new Sim([...roles]);
    expect(neutral.player('mistress').team).toBe('neutral');
  });
});

describe('Шут', () => {
  it('побеждает, если его казнят; по умолчанию игра продолжается', () => {
    const g = new Sim(['jester', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('jester');
    g.tally();
    expect(g.alive('jester')).toBe(false);
    expect(g.state.personalWinners).toEqual([g.id('jester')]);
    const win = g.ev('personalWin')[0];
    expect(win?.targets).toEqual([g.id('jester')]);
    expect(win?.data.role).toBe('jester');
    expect(win?.visibility.all).toBe(true);
    expect(g.state.phase).toBe('night');

    // доигрываем: красные казнят мафию, Шут остаётся среди победителей
    g.night();
    g.voteAll('mafia');
    g.tally();
    expect(g.state.result?.outcome).toBe('red');
    expect(g.state.result?.winners).toContain(g.id('jester'));
  });

  it('с правилом «казнь Шута заканчивает игру» игра сразу заканчивается его победой', () => {
    const g = new Sim(['jester', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian'], {
      rules: { jesterWinEndsGame: true },
    });
    g.night();
    g.voteAll('jester');
    g.tally();
    expect(g.state.phase).toBe('ended');
    expect(g.state.result).toMatchObject({ outcome: 'jester', reason: 'jesterExecuted', winners: [g.id('jester')] });
  });

  it('убитый ночью, не побеждает', () => {
    const g = new Sim(['jester', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'jester');
    g.night();
    expect(g.state.personalWinners).toEqual([]);
    g.voteAll('mafia');
    g.tally();
    expect(g.state.result?.winners).not.toContain(g.id('jester'));
  });
});

describe('Выживший', () => {
  it('побеждает вместе с любой победившей стороной, если жив', () => {
    const withRed = new Sim(['survivor', 'mafia', 'civilian', 'civilian', 'civilian']);
    withRed.night();
    withRed.voteAll('mafia');
    withRed.tally();
    expect(withRed.state.result?.outcome).toBe('red');
    expect(withRed.state.result?.winners).toContain(withRed.id('survivor'));

    const withBlack = new Sim(['survivor', 'mafia', 'civilian', 'civilian']);
    withBlack.mafia('mafia', 'p3').night();
    withBlack.skipDay();
    withBlack.mafia('mafia', 'p4').night();
    expect(withBlack.state.result?.outcome).toBe('black');
    expect(withBlack.state.result?.winners).toEqual([withBlack.id('survivor'), withBlack.id('mafia')]);
  });

  it('проигрывает, если погиб', () => {
    const g = new Sim(['survivor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'survivor').night();
    g.voteAll('mafia');
    g.tally();
    expect(g.state.result?.outcome).toBe('red');
    expect(g.state.result?.winners).not.toContain(g.id('survivor'));
  });
});

describe('Подрывник', () => {
  it('казнённый, забирает одного из голосовавших против и побеждает', () => {
    const g = new Sim(['bomber', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('p3', 'bomber').vote('p4', 'bomber').vote('mafia', 'bomber');
    g.vote('p5', 'p3');
    g.tally();
    expect(g.alive('bomber')).toBe(false);
    expect(g.state.personalWinners).toEqual([g.id('bomber')]);
    const head = currentDecision(g.state);
    expect(head).toMatchObject({ kind: 'bomberBlast', playerId: g.id('bomber') });
    expect(head?.options).toEqual(['p2', 'p3', 'p4']);

    // того, кто не голосовал против, забрать нельзя
    expect(() => g.decide('bomber', { kind: 'bomberBlast', target: 'p5' })).toThrow(EngineError);

    g.decide('bomber', { kind: 'bomberBlast', target: 'p3' });
    expect(g.alive('p3')).toBe(false);
    expect(g.player('p3').death?.cause).toBe('bomberBlast');
    expect(g.state.phase).toBe('night');
  });

  it('по таймауту забирает случайного из голосовавших против', () => {
    const g = new Sim(['bomber', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('p3', 'bomber').vote('p4', 'bomber');
    g.tally();
    const a = resolvePendingDefault(g.state);
    const b = resolvePendingDefault(g.state);
    const blasted = a.state.players.filter((p) => p.death?.cause === 'bomberBlast').map((p) => p.id);
    expect(blasted).toHaveLength(1);
    expect(['p3', 'p4']).toContain(blasted[0]);
    // тот же вход — тот же результат
    expect(b.state).toEqual(a.state);
  });

  it('убитый ночью, никого не забирает и не побеждает', () => {
    const g = new Sim(['bomber', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'bomber').night();
    expect(g.state.pending).toEqual([]);
    expect(g.state.personalWinners).toEqual([]);
    expect(g.state.phase).toBe('day');
  });
});
