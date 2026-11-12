/**
 * Представление игры для конкретного игрока.
 *
 * Главное правило: в представлении нет чужих ролей, чужих действий и чужих результатов,
 * кроме разрешённых случаев:
 *   - чёрные знают свою команду;
 *   - роли погибших, если включено «показывать роль умершего»;
 *   - мёртвые видят всё, если включено «мёртвые видят все роли»;
 *   - после конца игры открыто всё.
 */
import { currentDecision } from './flow';
import { entryComplete, nightOptions } from './night';
import { findPlayer } from './state';
import type {
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  PlayerView,
  ViewEvent,
  ViewOptions,
  ViewPlayer,
  Visibility,
} from './types';

function matches(visibility: Visibility, viewer: PlayerState | null): boolean {
  if (visibility.all) return true;
  if (!viewer) return false;
  return visibility.players.includes(viewer.id) || visibility.teams.includes(viewer.team);
}

/** Видит ли зритель вообще всё: он ведущий, игра окончена или он мёртв при включённом правиле. */
function seesEverything(state: GameState, viewer: PlayerState | null, options?: ViewOptions): boolean {
  if (options?.seeAll) return true;
  if (state.phase === 'ended') return true;
  return viewer !== null && !viewer.alive && state.config.rules.deadSeeAllRoles;
}

function project(event: GameEvent, viewer: PlayerState | null, everything: boolean): ViewEvent | null {
  const base = { id: event.id, round: event.round, phase: event.phase, type: event.type };
  if (everything || matches(event.visibility, viewer)) {
    return {
      ...base,
      actors: [...event.actors],
      targets: [...event.targets],
      data: JSON.parse(JSON.stringify(event.data)),
      redacted: false,
    } as ViewEvent;
  }
  const stealth = event.stealth;
  if (stealth && matches(stealth.visibility, viewer)) {
    const source = event.data as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of stealth.data) {
      if (key in source) data[key] = JSON.parse(JSON.stringify(source[key]));
    }
    return {
      ...base,
      actors: stealth.actors ? [...event.actors] : [],
      targets: stealth.targets ? [...event.targets] : [],
      data,
      redacted: true,
    } as ViewEvent;
  }
  return null;
}

/**
 * Проекция одного события для зрителя: полное событие, скрытный вид или null (не показывать).
 * viewerId = null — общий экран.
 */
export function projectEvent(
  state: GameState,
  event: GameEvent,
  viewerId: PlayerId | null,
  options?: ViewOptions,
): ViewEvent | null {
  const viewer = viewerId === null ? null : (findPlayer(state, viewerId) ?? null);
  return project(event, viewer, seesEverything(state, viewer, options));
}

/** Проекция списка событий (например, событий последнего шага) для зрителя. */
export function projectEvents(
  state: GameState,
  events: readonly GameEvent[],
  viewerId: PlayerId | null,
  options?: ViewOptions,
): ViewEvent[] {
  const viewer = viewerId === null ? null : (findPlayer(state, viewerId) ?? null);
  const everything = seesEverything(state, viewer, options);
  const out: ViewEvent[] = [];
  for (const event of events) {
    const projected = project(event, viewer, everything);
    if (projected) out.push(projected);
  }
  return out;
}

/**
 * Представление игры для игрока. viewerId = null (или неизвестный id) — общий экран:
 * только то, что известно всем.
 *
 * `options.seeAll` — представление ведущего-наблюдателя: все роли, журнал целиком и «закулисье»
 * (чужие ночные ходы и голоса в реальном времени). Игрокам его давать нельзя.
 */
export function viewFor(state: GameState, viewerId: PlayerId | null, options?: ViewOptions): PlayerView {
  const viewer = viewerId === null ? null : (findPlayer(state, viewerId) ?? null);
  const everything = seesEverything(state, viewer, options);
  const rules = state.config.rules;
  const ended = state.phase === 'ended';

  const events = projectEvents(state, state.log, viewer ? viewer.id : null, options);

  // чьи роли зритель вправе знать
  const known = new Set<PlayerId>();
  for (const p of state.players) {
    if (everything || p.revealed) known.add(p.id);
    if (viewer && (p.id === viewer.id || (viewer.team === 'black' && p.team === 'black'))) known.add(p.id);
  }
  for (const e of events) {
    // роли, которые зритель узнал сам (Следователь) или получил от команды (Консильери)
    if (e.type === 'roleLearned' && !e.redacted) for (const id of e.targets) known.add(id);
  }

  const lovers = viewer
    ? state.lovers
        .filter((pair) => pair.includes(viewer.id))
        .map((pair) => (pair[0] === viewer.id ? pair[1] : pair[0]))
    : [];
  const silencedToday = state.phase === 'day' && state.day ? state.day.silenced : [];

  const players: ViewPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    alive: p.alive,
    role: known.has(p.id) ? p.role : null,
    team: known.has(p.id) ? p.team : null,
    deathCause: p.death && (rules.revealDeathCause || everything) ? p.death.cause : null,
    silenced: silencedToday.includes(p.id),
    lover: lovers.includes(p.id),
  }));

  let night: PlayerView['night'] = null;
  if (state.phase === 'night' && state.night) {
    const options = viewer ? nightOptions(state, viewer.id) : null;
    const submitted = viewer ? (state.night.actions[viewer.id] ?? {}) : {};
    let teamVotes: Record<PlayerId, PlayerId | null> | null = null;
    if (viewer && viewer.team === 'black') {
      teamVotes = {};
      for (const p of state.players) {
        const vote = state.night.actions[p.id]?.mafiaVote;
        if (p.alive && p.team === 'black' && vote !== undefined) teamVotes[p.id] = vote;
      }
    }
    night = {
      options,
      submitted: JSON.parse(JSON.stringify(submitted)),
      ready: options ? entryComplete(options, submitted) : true,
      teamVotes,
    };
  }

  let day: PlayerView['day'] = null;
  if (state.phase === 'day' && state.day) {
    const d = state.day;
    const open = state.transition === null && state.pending.length === 0;
    day = {
      stage: d.stage,
      candidates: d.candidates ? [...d.candidates] : null,
      voted: state.players.filter((p) => d.votes[p.id] !== undefined).map((p) => p.id),
      ballots: rules.votingMode === 'open' ? { ...d.votes } : null,
      canVote: Boolean(viewer?.alive) && open,
    };
    if (viewer && d.votes[viewer.id] !== undefined) day.myVote = d.votes[viewer.id];
  }

  const head = currentDecision(state);
  const decision =
    head && viewer && head.playerId === viewer.id
      ? { kind: head.kind, options: head.options, condemned: head.condemned }
      : null;

  return {
    viewer: viewer ? viewer.id : null,
    phase: state.phase,
    round: state.round,
    rules: { ...rules },
    you: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          role: viewer.role,
          team: viewer.team,
          alive: viewer.alive,
          uses: { ...viewer.uses },
          armor: viewer.armor,
          vetoUsed: viewer.vetoUsed,
          lovers,
          silenced: silencedToday.includes(viewer.id),
        }
      : null,
    players,
    night: ended ? null : night,
    day: ended ? null : day,
    waitingForDecision: !ended && state.pending.length > 0,
    decision,
    backstage: options?.seeAll
      ? {
          nightMoves: !ended && state.phase === 'night' && state.night ? JSON.parse(JSON.stringify(state.night.actions)) : {},
          votes: !ended && state.phase === 'day' && state.day ? { ...state.day.votes } : {},
          decision: head,
          lovers: state.lovers.map((pair) => [pair[0], pair[1]]),
        }
      : null,
    events,
    result: state.result ? { ...state.result, winners: [...state.result.winners] } : null,
  };
}
