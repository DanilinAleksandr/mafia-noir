import { castVote, resolveVote, submitNightAction, resolveNight } from '@mafia/engine';
import { describe, expect, it, vi } from 'vitest';
import { eventsFor, newGame, nightKill, snapshot } from '../test/fixtures';
import { digest, lastPhaseMarker, segment } from './digest';
import { Presenter } from './presenter';

const ROLES = ['mafia', 'commissioner', 'doctor', 'civilian', 'civilian'] as const;

describe('digest — пересказ событий', () => {
  it('утро: погибший с открытой ролью, без убийцы для мирного', () => {
    const state = nightKill(newGame([...ROLES]), 'm4');
    const night = segment(eventsFor(state, 'm5'), 'nightStarted');
    const report = digest(night, { me: 'm5', night: true });
    expect(report.public).toEqual([{ kind: 'death', player: 'm4', cause: 'mafiaKill', role: 'civilian', by: [] }]);
    expect(report.private).toEqual([]);
  });

  it('мафия видит своего исполнителя, мирные — нет', () => {
    const state = nightKill(newGame([...ROLES]), 'm4');
    const forMafia = digest(segment(eventsFor(state, 'm1'), 'nightStarted'), { me: 'm1', night: true });
    expect(forMafia.public[0]).toMatchObject({ kind: 'death', by: ['m1'] });
    expect(forMafia.private.some((b) => b.kind === 'mafiaTarget')).toBe(true);
  });

  it('тихая ночь и спасение: «никто не погиб» и анонимное «кого-то спасли»', () => {
    let s = newGame([...ROLES]);
    s = submitNightAction(s, 'm1', { kind: 'mafiaVote', target: 'm4' }).state;
    s = submitNightAction(s, 'm2', { kind: 'pass' }).state;
    s = submitNightAction(s, 'm3', { kind: 'ability', ability: 'heal', targets: ['m4'] }).state;
    s = submitNightAction(s, 'm4', { kind: 'pass' }).state;
    s = submitNightAction(s, 'm5', { kind: 'pass' }).state;
    s = resolveNight(s).state;
    const forCivilian = digest(segment(eventsFor(s, 'm5'), 'nightStarted'), { me: 'm5', night: true });
    expect(forCivilian.public).toEqual([{ kind: 'quietNight' }, { kind: 'saved', target: null, by: null, mine: false }]);
    const forDoctor = digest(segment(eventsFor(s, 'm3'), 'nightStarted'), { me: 'm3', night: true });
    expect(forDoctor.private).toContainEqual({ kind: 'saved', target: 'm4', by: 'heal', mine: true });
  });

  it('результат проверки Комиссара — только в личном', () => {
    let s = newGame([...ROLES]);
    s = submitNightAction(s, 'm1', { kind: 'mafiaVote', target: 'm5' }).state;
    s = submitNightAction(s, 'm2', { kind: 'ability', ability: 'check', targets: ['m1'] }).state;
    for (const id of ['m3', 'm4', 'm5']) s = submitNightAction(s, id, { kind: 'pass' }).state;
    s = resolveNight(s).state;
    const forComm = digest(segment(eventsFor(s, 'm2'), 'nightStarted'), { me: 'm2', night: true });
    expect(forComm.private).toContainEqual({ kind: 'checked', target: 'm1', isMafia: true });
    const forOther = digest(segment(eventsFor(s, 'm4'), 'nightStarted'), { me: 'm4', night: true });
    expect(forOther.private.some((b) => b.kind === 'checked')).toBe(false);
  });

  it('вечер: итог голосования и казнь, сцены «Кино» уходят в личное', () => {
    let s = nightKill(newGame([...ROLES]), 'm5');
    for (const id of ['m2', 'm3', 'm4']) s = castVote(s, id, 'm1').state;
    s = castVote(s, 'm1', 'm2').state;
    s = resolveVote(s).state;
    const events = eventsFor(s, 'm4');
    expect(lastPhaseMarker(events)).toBe('dayStarted');
    const report = digest(segment(events, 'dayStarted'), { me: 'm4' });
    expect(report.public[0]).toMatchObject({ kind: 'voteResult', outcome: 'condemned', leaders: ['m1'] });
    expect(report.public).toContainEqual({ kind: 'death', player: 'm1', cause: 'execution', role: 'mafia', by: [] });

    const withScene = digest([], { me: 'm2', scenes: [{ id: 9, round: 1, ability: 'heal', role: 'doctor', saved: true }], night: true });
    expect(withScene.private).toEqual([{ kind: 'scene', scene: { id: 9, round: 1, ability: 'heal', role: 'doctor', saved: true } }]);
  });
});

describe('Presenter — очередь представлений', () => {
  it('начало партии — раздача роли; утро — итоги ночи; «готов» после просмотра', () => {
    const done = vi.fn();
    const presenter = new Presenter(done);
    const start = newGame([...ROLES]);
    presenter.update({
      game: snapshot(start, 'm4', 'night'),
      events: eventsFor(start, 'm4'),
      scenes: [],
      fresh: eventsFor(start, 'm4'),
      initial: false,
      readyStep: -1,
      narrator: false,
      roleSeen: false,
    });
    expect(presenter.current?.kind).toBe('roleReveal');
    presenter.complete(presenter.current!.id);

    const morning = nightKill(start, 'm5');
    presenter.update({
      game: snapshot(morning, 'm4', 'morning', { step: 2 }),
      events: eventsFor(morning, 'm4'),
      scenes: [],
      fresh: [],
      initial: false,
      readyStep: -1,
      narrator: false,
      roleSeen: true,
    });
    const report = presenter.current;
    expect(report).toMatchObject({ kind: 'nightReport', step: 2, round: 1 });
    // повторный снимок того же утра не ставит отчёт второй раз
    presenter.update({
      game: snapshot(morning, 'm4', 'morning', { step: 2 }),
      events: eventsFor(morning, 'm4'),
      scenes: [],
      fresh: [],
      initial: false,
      readyStep: -1,
      narrator: false,
      roleSeen: true,
    });
    expect(presenter.size).toBe(1);
    presenter.complete(report!.id);
    expect(done).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'nightReport', step: 2 }));
    expect(presenter.current).toBeNull();
  });

  it('после переподключения, когда «готов» уже отправлен, отчёт не повторяется', () => {
    const presenter = new Presenter();
    const morning = nightKill(newGame([...ROLES]), 'm5');
    presenter.update({
      game: snapshot(morning, 'm4', 'morning', { step: 2 }),
      events: eventsFor(morning, 'm4'),
      scenes: [],
      fresh: [],
      initial: true,
      readyStep: 2,
      narrator: false,
      roleSeen: true,
    });
    expect(presenter.current).toBeNull();
  });

  it('ведущему отчёты не показываются', () => {
    const presenter = new Presenter();
    const morning = nightKill(newGame([...ROLES]), 'm5');
    presenter.update({
      game: snapshot(morning, null, 'morning', { step: 2 }, true),
      events: eventsFor(morning, null, true),
      scenes: [],
      fresh: [],
      initial: false,
      readyStep: -1,
      narrator: true,
      roleSeen: true,
    });
    expect(presenter.current).toBeNull();
  });
});
