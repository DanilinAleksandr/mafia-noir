import { describe, expect, it } from 'vitest';
import {
  type GameState,
  type PlayerView,
  type RoleId,
  type Rules,
  createGame,
  projectEvent,
  projectEvents,
  viewFor,
} from '../src/index';
import { Sim, allowedToKnow, findLeaks, playRandomGame } from './helpers';

const roleOf = (view: PlayerView, id: string) => view.players.find((p) => p.id === id)?.role;
const types = (view: PlayerView) => view.events.map((e) => e.type);

describe('viewFor: начало игры', () => {
  const roles: RoleId[] = ['civilian', 'doctor', 'mafia', 'don', 'commissioner', 'maniac', 'civilian'];

  it('мирный видит только свою роль', () => {
    const g = new Sim(roles);
    const view = g.view('p1');
    expect(view.you).toMatchObject({ id: 'p1', role: 'civilian', team: 'red', alive: true });
    expect(view.players.map((p) => p.role)).toEqual(['civilian', null, null, null, null, null, null]);
    expect(view.players.map((p) => p.team)).toEqual(['red', null, null, null, null, null, null]);
    expect(types(view)).toEqual(['gameStarted', 'roleAssigned', 'nightStarted']);
    expect(view.events[1]).toMatchObject({ targets: ['p1'], data: { role: 'civilian' }, redacted: false });
  });

  it('мафия знает своих — и только своих', () => {
    const g = new Sim(roles);
    const view = g.view('mafia');
    expect(view.players.map((p) => p.role)).toEqual([null, null, 'mafia', 'don', null, null, null]);
    const team = view.events.find((e) => e.type === 'teamRevealed');
    expect(team?.data).toEqual({ roles: { p3: 'mafia', p4: 'don' } });
    expect(types(g.view('maniac'))).not.toContain('teamRevealed');
    expect(types(g.view('commissioner'))).not.toContain('teamRevealed');
  });

  it('общий экран (зритель) не видит ни одной роли', () => {
    const g = new Sim(roles);
    const view = g.view(null);
    expect(view.viewer).toBeNull();
    expect(view.you).toBeNull();
    expect(view.players.every((p) => p.role === null && p.team === null)).toBe(true);
    expect(types(view)).toEqual(['gameStarted', 'nightStarted']);
    expect(viewFor(g.state, 'no-such-player').you).toBeNull();
  });

  it('представление не зависит от того, как розданы чужие роли', () => {
    const deal = (order: RoleId[]): GameState =>
      createGame({}, order.map((role, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}`, role })), 's').state;
    const a = deal(['civilian', 'doctor', 'mafia', 'don', 'commissioner', 'maniac', 'civilian']);
    const b = deal(['civilian', 'maniac', 'commissioner', 'civilian', 'don', 'doctor', 'mafia']);
    expect(viewFor(a, 'p1')).toEqual(viewFor(b, 'p1'));
    expect(viewFor(a, null)).toEqual(viewFor(b, null));
  });

  it('в представлении нет полного состояния: ни журнала с видимостью, ни чужих действий', () => {
    const g = new Sim(roles);
    const json = JSON.stringify(g.view('p1'));
    expect(json).not.toContain('visibility');
    expect(json).not.toContain('stealth');
    expect(json).not.toContain('"actions"');
    expect(json).not.toContain('"rng"');
  });
});

describe('viewFor: ночь', () => {
  it('чужое ночное действие никак не меняет представление остальных', () => {
    const g = new Sim(['doctor', 'commissioner', 'mafia', 'don', 'maniac', 'civilian', 'civilian', 'civilian']);
    const others = ['p2', 'p3', 'p4', 'p5', 'p6', null];
    const before = others.map((v) => g.view(v));
    g.act('doctor', 'heal', 'p6');
    expect(others.map((v) => g.view(v))).toEqual(before);
    // сам Доктор видит, что отправил
    expect(g.view('doctor').night?.submitted).toEqual({ ability: { id: 'heal', targets: ['p6'] } });
    expect(g.view('doctor').night?.ready).toBe(true);
  });

  it('голос мафии видит только чёрная команда', () => {
    const g = new Sim(['doctor', 'commissioner', 'mafia', 'don', 'maniac', 'civilian', 'civilian', 'civilian']);
    const outsiders = ['p1', 'p2', 'p5', 'p6', null];
    const before = outsiders.map((v) => g.view(v));
    g.mafia('mafia', 'p6');
    expect(outsiders.map((v) => g.view(v))).toEqual(before);
    expect(g.view('don').night?.teamVotes).toEqual({ p3: 'p6' });
    expect(g.view('mafia').night?.teamVotes).toEqual({ p3: 'p6' });
    expect(g.view('p1').night?.teamVotes).toBeNull();
  });

  it('игрок видит свои варианты действий, а не чужие', () => {
    const g = new Sim(['doctor', 'commissioner', 'mafia', 'civilian', 'civilian']);
    expect(g.view('doctor').night?.options?.abilities.map((a) => a.id)).toEqual(['heal']);
    expect(g.view('doctor').night?.options?.mafiaVote).toBeNull();
    expect(g.view('mafia').night?.options).toEqual({ abilities: [], mafiaVote: { candidates: ['p1', 'p2', 'p4', 'p5'] } });
    expect(g.view('p4').night?.options).toEqual({ abilities: [], mafiaVote: null });
    expect(g.view('p4').night?.ready).toBe(true);
    expect(g.view(null).night?.options).toBeNull();
  });

  it('результат проверки видит только Комиссар', () => {
    const g = new Sim(['commissioner', 'mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.act('commissioner', 'check', 'mafia').night();
    const own = g.view('commissioner').events.find((e) => e.type === 'checked');
    expect(own).toMatchObject({ actors: ['p1'], targets: ['p2'], data: { isMafia: true }, redacted: false });
    for (const viewer of ['p2', 'p3', 'p4', null]) {
      expect(types(g.view(viewer)), String(viewer)).not.toContain('checked');
    }
    // проверка — не раскрытие роли: в списке игроков роль по-прежнему скрыта
    expect(roleOf(g.view('commissioner'), 'p2')).toBeNull();
  });

  it('ночное убийство: все видят жертву и причину, убийцу — только чёрные', () => {
    const g = new Sim(['mafia', 'don', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.mafia('mafia', 'p3').mafia('don', 'p3').night();
    const forDon = g.view('don').events.find((e) => e.type === 'death');
    expect(forDon?.redacted).toBe(false);
    expect(forDon?.actors).toHaveLength(1);
    const forCivilian = g.view('p4').events.find((e) => e.type === 'death');
    expect(forCivilian).toMatchObject({ redacted: true, actors: [], targets: ['p3'], data: { cause: 'mafiaKill' } });
    expect(types(g.view('p4'))).not.toContain('mafiaTargetChosen');
    expect(types(g.view('don'))).toContain('mafiaTargetChosen');
  });
});

describe('viewFor: правила раскрытия', () => {
  const roles: RoleId[] = ['mafia', 'doctor', 'commissioner', 'civilian', 'civilian', 'civilian'];
  const killDoctor = (rules: Partial<Rules>) => {
    const g = new Sim(roles, { rules });
    g.mafia('mafia', 'doctor').night();
    return g;
  };

  it('роль умершего показывается всем, если включено', () => {
    const g = killDoctor({ revealRoleOnDeath: true });
    expect(roleOf(g.view('p4'), 'p2')).toBe('doctor');
    expect(roleOf(g.view(null), 'p2')).toBe('doctor');
    expect(types(g.view('p4'))).toContain('roleRevealed');
  });

  it('роль умершего скрыта, если выключено', () => {
    const g = killDoctor({ revealRoleOnDeath: false });
    expect(roleOf(g.view('p4'), 'p2')).toBeNull();
    expect(types(g.view('p4'))).not.toContain('roleRevealed');
    expect(findLeaks(g.state, 'p4')).toEqual([]);
  });

  it('причина смерти скрыта, если выключено', () => {
    const g = killDoctor({ revealDeathCause: false });
    const view = g.view('p4');
    expect(view.players.find((p) => p.id === 'p2')?.deathCause).toBeNull();
    expect(view.events.find((e) => e.type === 'death')).toMatchObject({ redacted: true, targets: ['p2'], data: {} });
    // мафия свою работу знает
    expect(g.view('mafia').events.find((e) => e.type === 'death')?.data).toEqual({ cause: 'mafiaKill' });
  });

  it('мёртвые видят все роли и полный журнал, только если включено', () => {
    const on = killDoctor({ deadSeeAllRoles: true });
    expect(on.view('doctor').players.map((p) => p.role)).toEqual(roles);
    expect(on.view('doctor').events.every((e) => !e.redacted)).toBe(true);
    expect(types(on.view('doctor'))).toContain('mafiaTargetChosen');
    // живые по-прежнему не видят
    expect(roleOf(on.view('p4'), 'p1')).toBeNull();

    const off = killDoctor({ deadSeeAllRoles: false });
    expect(roleOf(off.view('doctor'), 'p1')).toBeNull();
    expect(types(off.view('doctor'))).not.toContain('mafiaTargetChosen');
  });
});

describe('viewFor: день и голосование', () => {
  const roles: RoleId[] = ['mafia', 'mayor', 'civilian', 'civilian', 'civilian', 'civilian'];
  const withoutVoted = (view: PlayerView) => ({ ...view, day: view.day ? { ...view.day, voted: [] } : null });

  it('тайное: чужой голос не виден, виден только факт голосования', () => {
    const g = new Sim(roles);
    g.night();
    const others = ['p1', 'p2', 'p4', null];
    const before = others.map((v) => withoutVoted(g.view(v)));
    g.vote('p3', 'p1');
    expect(others.map((v) => withoutVoted(g.view(v)))).toEqual(before);
    expect(g.view('p4').day).toMatchObject({ voted: ['p3'], ballots: null, canVote: true });
    expect(g.view('p4').day?.myVote).toBeUndefined();
    expect(g.view('p3').day?.myVote).toBe('p1');
  });

  it('тайное: после подсчёта видны только суммы, бюллетени — нет', () => {
    const g = new Sim(roles);
    g.night();
    g.vote('p3', 'p4').vote('p5', 'p4').vote('p4', 'p3');
    g.tally();
    for (const viewer of ['p1', 'p3', 'p4', null]) {
      const view = g.view(viewer);
      expect(types(view)).toContain('voteResult');
      expect(types(view)).not.toContain('ballotsRevealed');
    }
    expect(g.view('p1').events.find((e) => e.type === 'voteResult')?.data).toMatchObject({ tally: { p4: 2, p3: 1 } });
  });

  it('revealAfter: бюллетени видны всем после подсчёта, но не во время голосования', () => {
    const g = new Sim(roles, { rules: { votingMode: 'revealAfter' } });
    g.night();
    g.vote('p3', 'p4').vote('p5', 'p4');
    expect(g.view('p1').day?.ballots).toBeNull();
    g.tally();
    const ballots = g.view('p1').events.find((e) => e.type === 'ballotsRevealed');
    expect(ballots?.data).toEqual({ ballots: { p1: null, p2: null, p3: 'p4', p4: null, p5: 'p4', p6: null } });
  });

  it('open: голоса видны сразу', () => {
    const g = new Sim(roles, { rules: { votingMode: 'open' } });
    g.night();
    g.vote('p3', 'p4');
    expect(g.view('p1').day?.ballots).toEqual({ p3: 'p4' });
    expect(g.view(null).day?.ballots).toEqual({ p3: 'p4' });
  });

  it('мёртвый не может голосовать', () => {
    const g = new Sim(roles);
    g.mafia('mafia', 'p3').night();
    expect(g.view('p3').day?.canVote).toBe(false);
    expect(g.view('p4').day?.canVote).toBe(true);
    expect(g.view(null).day?.canVote).toBe(false);
  });
});

describe('viewFor: отложенные решения', () => {
  it('решение видит только тот, от кого его ждут; остальные знают лишь, что игра ждёт', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian'], {
      rules: { revealRoleOnDeath: false },
    });
    g.mafia('mafia', 'hunter').night();
    expect(g.view('hunter').decision).toEqual({
      kind: 'hunterShot',
      options: ['p2', 'p3', 'p4', 'p5', 'p6'],
      condemned: null,
    });
    for (const viewer of ['p2', 'p3', null]) {
      const view = g.view(viewer);
      expect(view.decision).toBeNull();
      expect(view.waitingForDecision).toBe(true);
      expect(JSON.stringify(view)).not.toContain('hunterShot');
    }
  });

  it('Судья видит, кого собираются казнить', () => {
    const g = new Sim(['judge', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.voteAll('p3');
    g.tally();
    expect(g.view('judge').decision).toEqual({ kind: 'judgeVeto', options: [], condemned: 'p3' });
    expect(g.view('p3').decision).toBeNull();
    expect(g.view('p3').day?.canVote).toBe(false);
  });
});

describe('projectEvent', () => {
  it('даёт полное событие, скрытный вид или ничего', () => {
    const g = new Sim(['mistress', 'doctor', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'doctor');
    const events = g.night();
    const blocked = events.find((e) => e.type === 'blocked');
    if (!blocked) throw new Error('нет события blocked');

    expect(projectEvent(g.state, blocked, 'p1')).toMatchObject({ redacted: false, actors: ['p1'], targets: ['p2'] });
    expect(projectEvent(g.state, blocked, 'p2')).toMatchObject({ redacted: true, actors: [], targets: ['p2'] });
    expect(projectEvent(g.state, blocked, 'p4')).toBeNull();
    expect(projectEvent(g.state, blocked, null)).toBeNull();

    // события шага для рассылки: каждому — своя проекция
    expect(projectEvents(g.state, events, 'p4').map((e) => e.type)).toEqual(['dayStarted']);
    expect(projectEvents(g.state, events, 'p2').map((e) => e.type)).toEqual(['blocked', 'dayStarted']);
  });
});

describe('viewFor: утечек нет ни в одной фазе (случайные игры)', () => {
  const rulesets: Partial<Rules>[] = [
    {},
    { revealRoleOnDeath: false, revealDeathCause: false },
    { deadSeeAllRoles: true, votingMode: 'revealAfter' },
    { mistressMode: 'red', votingMode: 'open', announceSaves: false },
    { jesterWinEndsGame: true, commissionerSeesManiacAsMafia: true, commissionerSeesDonAsMafia: false },
  ];

  it('чужие роли не встречаются в представлении нигде, пока их нельзя знать', () => {
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      const rules = rulesets[i % rulesets.length] as Partial<Rules>;
      playRandomGame(`leak-${i}`, { rules }, undefined, {
        onState: (state) => {
          for (const viewer of [...state.players.map((p) => p.id), null]) {
            expect(findLeaks(state, viewer), `seed leak-${i}`).toEqual([]);
            checked++;
          }
        },
      });
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('чужое действие не меняет представление тех, кому оно не адресовано', () => {
    const stable = (state: GameState, viewer: string | null): string => {
      const view = viewFor(state, viewer);
      // список проголосовавших публичен по замыслу — его из сравнения убираем
      return JSON.stringify({ ...view, day: view.day ? { ...view.day, voted: [] } : null });
    };
    let compared = 0;
    for (let i = 0; i < 15; i++) {
      const rules = rulesets[i % 3] as Partial<Rules>;
      playRandomGame(`quiet-${i}`, { rules }, undefined, {
        onSubmit: (before, after, actorId, kind) => {
          const actor = after.players.find((p) => p.id === actorId);
          for (const viewer of [...after.players.map((p) => p.id), null]) {
            if (viewer === actorId) continue;
            const teammate =
              kind === 'mafiaVote' && actor?.team === 'black' && after.players.find((p) => p.id === viewer)?.team === 'black';
            if (teammate) continue;
            expect(stable(after, viewer), `seed quiet-${i}, ${kind} от ${actorId}`).toBe(stable(before, viewer));
            compared++;
          }
        },
      });
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it('оракул теста согласован с движком: всё разрешённое действительно показывается', () => {
    playRandomGame('oracle', {}, 10, {
      onState: (state) => {
        for (const p of state.players) {
          const known = allowedToKnow(state, p.id);
          const view = viewFor(state, p.id);
          for (const vp of view.players) expect(vp.role !== null).toBe(known.has(vp.id));
        }
      },
    });
  });
});

describe('Событие «способность применена»', () => {
  it('записывается для каждой сработавшей способности и видно только применившему', () => {
    const g = new Sim(['doctor', 'commissioner', 'mafia', 'civilian', 'civilian', 'civilian']);
    g.act('doctor', 'heal', 'p4').act('commissioner', 'check', 'p3').mafia('mafia', 'p5');
    g.night();
    const used = g.ev('abilityUsed');
    expect(used.map((e) => [e.actors[0], e.data.ability, e.targets])).toEqual([
      ['p1', 'heal', ['p4']],
      ['p2', 'check', ['p3']],
    ]);
    for (const event of used) {
      expect(event.visibility).toEqual({ all: false, teams: [], players: [event.actors[0]] });
      expect(event.stealth).toBeNull();
    }
    // тот, на кого подействовали, об этом не узнаёт
    expect(g.view('p4').events.some((e) => e.type === 'abilityUsed')).toBe(false);
    expect(g.view('p3').events.some((e) => e.type === 'abilityUsed')).toBe(false);
    expect(g.view('p1').events.filter((e) => e.type === 'abilityUsed')).toHaveLength(1);
  });

  it('заблокированная способность и отказ событий не дают', () => {
    const g = new Sim(['mistress', 'doctor', 'commissioner', 'mafia', 'civilian', 'civilian']);
    g.act('mistress', 'block', 'doctor').act('doctor', 'heal', 'p5').pass('commissioner');
    g.night();
    expect(g.ev('abilityUsed').map((e) => e.data.ability)).toEqual(['block']);
  });
});

describe('Убийца не раскрывается', () => {
  it('выстрел Охотника: кто стрелял, видит только он сам', () => {
    const g = new Sim(['hunter', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian'], {
      rules: { revealRoleOnDeath: false },
    });
    g.mafia('mafia', 'hunter').night();
    g.decide('hunter', { kind: 'hunterShot', target: 'p3' });
    const forOthers = g.view('p4').events.filter((e) => e.type === 'death');
    expect(forOthers.map((e) => [e.targets[0], e.actors, e.data])).toEqual([
      ['p1', [], { cause: 'mafiaKill' }],
      ['p3', [], { cause: 'hunterShot' }],
    ]);
    expect(g.view('hunter').events.find((e) => e.type === 'death' && e.targets[0] === 'p3')?.actors).toEqual(['p1']);
    expect(g.view(null).events.every((e) => e.type !== 'death' || e.actors.length === 0)).toBe(true);
  });

  it('взрыв Подрывника: кто взорвал, видит только он сам', () => {
    const g = new Sim(['bomber', 'mafia', 'civilian', 'civilian', 'civilian', 'civilian']);
    g.night();
    g.vote('p3', 'bomber').vote('p4', 'bomber');
    g.tally();
    g.decide('bomber', { kind: 'bomberBlast', target: 'p3' });
    const seen = g.view('p5').events.find((e) => e.type === 'death' && e.targets[0] === 'p3');
    expect(seen).toMatchObject({ redacted: true, actors: [], data: { cause: 'bomberBlast' } });
  });

  it('в случайных партиях никто, кроме самого убийцы и его чёрной команды, не видит, кто убил', () => {
    let deaths = 0;
    for (let i = 0; i < 25; i++) {
      playRandomGame(`killer-${i}`, { rules: { revealRoleOnDeath: i % 2 === 0 } }, undefined, {
        onState: (state) => {
          if (state.phase === 'ended') return;
          for (const viewer of state.players) {
            if (!viewer.alive && state.config.rules.deadSeeAllRoles) continue;
            for (const event of viewFor(state, viewer.id).events) {
              if (event.type !== 'death' || event.actors.length === 0) continue;
              deaths++;
              const own = event.actors.includes(viewer.id);
              const team = event.data.cause === 'mafiaKill' && viewer.team === 'black';
              expect(own || team, `killer-${i}: ${viewer.id} видит убийцу`).toBe(true);
            }
          }
        },
      });
    }
    expect(deaths).toBeGreaterThan(100);
  });
});

describe('Представление ведущего (seeAll)', () => {
  const roles: RoleId[] = ['mafia', 'don', 'doctor', 'commissioner', 'hunter', 'civilian', 'civilian'];

  it('видит все роли и журнал целиком, но остаётся наблюдателем', () => {
    const g = new Sim(roles);
    const view = viewFor(g.state, null, { seeAll: true });
    expect(view.viewer).toBeNull();
    expect(view.you).toBeNull();
    expect(view.players.map((p) => p.role)).toEqual(roles);
    expect(view.events.map((e) => e.type)).toEqual(g.state.log.map((e) => e.type));
    expect(view.events.every((e) => !e.redacted)).toBe(true);
    expect(view.night?.options).toBeNull();
    expect(view.decision).toBeNull();
  });

  it('видит чужие ночные ходы и голоса в реальном времени, а также чьего решения ждёт игра', () => {
    const g = new Sim(roles);
    const backstage = () => viewFor(g.state, null, { seeAll: true }).backstage;
    expect(backstage()).toEqual({ nightMoves: {}, votes: {}, decision: null, lovers: [] });

    g.mafia('mafia', 'p5').act('doctor', 'heal', 'p6');
    expect(backstage()?.nightMoves).toEqual({
      p1: { mafiaVote: 'p5' },
      p3: { ability: { id: 'heal', targets: ['p6'] } },
    });

    g.night();
    // Охотник убит: ведущий знает, что решение за ним
    expect(backstage()?.decision).toMatchObject({ kind: 'hunterShot', playerId: 'p5' });
    g.decide('hunter', { kind: 'hunterShot', target: null });

    g.vote('p6', 'p1').vote('p7', null);
    expect(backstage()?.votes).toEqual({ p6: 'p1', p7: null });
    expect(backstage()?.nightMoves).toEqual({});
  });

  it('полные события доступны ведущему сразу — включая результаты проверок', () => {
    const g = new Sim(roles);
    g.act('commissioner', 'check', 'don').mafia('mafia', 'p6');
    const events = g.night();
    const seen = projectEvents(g.state, events, null, { seeAll: true });
    expect(seen).toHaveLength(events.length);
    expect(seen.find((e) => e.type === 'checked')).toMatchObject({ actors: ['p4'], targets: ['p2'], data: { isMafia: true } });
    expect(seen.find((e) => e.type === 'death')?.actors).toHaveLength(1);
    expect(projectEvent(g.state, events[0] as never, null)).toBeNull();
    expect(projectEvent(g.state, events[0] as never, null, { seeAll: true })).not.toBeNull();
  });

  it('у игроков и у общего экрана «закулисья» нет никогда', () => {
    for (let i = 0; i < 10; i++) {
      playRandomGame(`backstage-${i}`, {}, undefined, {
        onState: (state) => {
          for (const viewer of [...state.players.map((p) => p.id), null]) {
            expect(viewFor(state, viewer).backstage).toBeNull();
          }
        },
      });
    }
  });
});
