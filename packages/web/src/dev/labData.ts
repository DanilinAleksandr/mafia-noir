/**
 * Данные для страницы /dev/scenes: партия, собранная настоящим движком вокруг выбранной роли,
 * и представления, построенные так же, как в игре (digest по журналу).
 */
import {
  castVote,
  createGame,
  projectEvents,
  resolveNight,
  resolveVote,
  submitNightAction,
  viewFor,
} from '@mafia/engine';
import type { GameState, PlayerId, RoleId } from '@mafia/engine';
import type { ClientView, Scene } from '@mafia/protocol';
import { digest, lastPhaseMarker, scenesOfRound, segment } from '../presenter/digest';
import type { Presentation, PresentationKind } from '../presenter/presenter';

export const LAB_NAMES = ['Аня', 'Борис', 'Вера', 'Гоша', 'Даша', 'Егор', 'Жора'];

/** Состав: игрок m1 — выбранная роль, остальные — типичный стол с напарником мафии. */
function rolesAround(role: RoleId): RoleId[] {
  const rest: RoleId[] = [role === 'don' ? 'mafia' : 'don', 'commissioner', 'doctor', 'civilian', 'maniac', 'civilian'];
  return [role, ...rest.map((r) => (r === role && r !== 'civilian' ? 'civilian' : r))];
}

function start(role: RoleId): GameState {
  const roles = rolesAround(role);
  return createGame(
    {},
    roles.map((r, i) => ({ id: `m${i + 1}`, name: LAB_NAMES[i] ?? `Игрок ${i + 1}`, role: r })),
    'lab',
  ).state;
}

function view(state: GameState, me: PlayerId): ClientView {
  const { events: _events, ...rest } = viewFor(state, me);
  return rest;
}

/** Ночь: чёрные убивают m5, Доктор лечит m1, Комиссар проверяет m2. */
function night(state: GameState): GameState {
  let s = state;
  for (const p of s.players) {
    if (!p.alive) continue;
    if (p.role === 'doctor') s = submitNightAction(s, p.id, { kind: 'ability', ability: 'heal', targets: ['m1'] }).state;
    else if (p.role === 'commissioner') s = submitNightAction(s, p.id, { kind: 'ability', ability: 'check', targets: ['m2'] }).state;
    else s = submitNightAction(s, p.id, { kind: 'pass' }).state;
    if (p.team === 'black') s = submitNightAction(s, p.id, { kind: 'mafiaVote', target: 'm5' }).state;
  }
  return resolveNight(s).state;
}

function day(state: GameState): GameState {
  let s = state;
  for (const p of s.players) if (p.alive) s = castVote(s, p.id, p.id === 'm2' ? 'm3' : 'm2').state;
  return resolveVote(s).state;
}

export interface LabCase {
  presentation: Presentation;
  view: ClientView;
}

export function labCase(kind: PresentationKind, role: RoleId, cinema: boolean): LabCase {
  const me = 'm1';
  const s0 = start(role);
  if (kind === 'roleReveal') return { presentation: { id: 1, kind: 'roleReveal' }, view: view(s0, me) };

  const s1 = night(s0);
  if (kind === 'nightReport') {
    const events = projectEvents(s1, s1.log, me);
    const scenes: Scene[] = cinema ? [{ id: 0, round: 1, ability: 'heal', role: 'doctor', saved: false }] : [];
    return {
      presentation: {
        id: 2,
        kind: 'nightReport',
        round: 1,
        step: 2,
        report: digest(segment(events, 'nightStarted'), { me, scenes: scenesOfRound(scenes, 1), night: true }),
      },
      view: view(s1, me),
    };
  }
  const s2 = day(s1);
  const events = projectEvents(s2, s2.log, me);
  if (kind === 'verdict') {
    return {
      presentation: { id: 3, kind: 'verdict', round: 1, step: 4, report: digest(segment(events, 'dayStarted'), { me }) },
      view: view(s2, me),
    };
  }
  // финал: доигрываем, пока игра не кончится
  let s = s2;
  for (let i = 0; i < 6 && s.phase !== 'ended'; i++) {
    s = s.phase === 'night' ? night(s) : day(s);
  }
  const marker = lastPhaseMarker(projectEvents(s, s.log, me));
  void marker;
  return {
    presentation: { id: 4, kind: 'finale', result: s.result ?? { outcome: 'red', reason: 'threatsEliminated', winners: [] } },
    view: view(s, me),
  };
}
