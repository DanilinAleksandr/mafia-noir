/**
 * Из событий движка — «такты» (beats) для показа: итоги ночи, приговор, финал.
 *
 * Чистые функции без React. Сейчас по тактам рисуются простые экраны; кинематографичный слой
 * (этап 4) будет проигрывать по тем же тактам полноценные сцены. Клиент ничего не вычисляет
 * сверх событий: такт — это пересказ события, которое сервер уже прислал этому игроку.
 */
import type {
  AbilityId,
  DeathCause,
  GameResult,
  PlayerId,
  RoleId,
  SaveKind,
  ViewEvent,
} from '@mafia/engine';
import type { Scene } from '@mafia/protocol';

export type Beat =
  /** Игрок погиб. `role` — если роль объявлена, `cause` — если причина объявлена. */
  | { kind: 'death'; player: PlayerId; cause: DeathCause | null; role: RoleId | null; by: PlayerId[] }
  /** Ночью никто не погиб. */
  | { kind: 'quietNight' }
  /** Кого-то спасли. Без подробностей — если спасали не вы. */
  | { kind: 'saved'; target: PlayerId | null; by: SaveKind | null; mine: boolean }
  | { kind: 'silenced'; player: PlayerId }
  /** Роль объявлена всем (кроме смерти — она уже в такте death). */
  | { kind: 'roleRevealed'; player: PlayerId; role: RoleId }
  // личное
  | { kind: 'blockedMe' }
  | { kind: 'myAction'; ability: AbilityId; targets: PlayerId[] }
  | { kind: 'checked'; target: PlayerId; isMafia: boolean }
  | { kind: 'roleLearned'; target: PlayerId; role: RoleId; byTeam: boolean }
  | { kind: 'visitors'; target: PlayerId; visitors: PlayerId[] }
  | { kind: 'compared'; targets: PlayerId[]; sameTeam: boolean }
  | { kind: 'lovers'; targets: PlayerId[] }
  | { kind: 'mafiaTarget'; target: PlayerId | null; decidedBy: 'votes' | 'don' | 'random' | null }
  | { kind: 'covered'; target: PlayerId }
  | { kind: 'blessedBy'; target: PlayerId }
  | { kind: 'scene'; scene: Scene }
  // день
  | {
      kind: 'voteResult';
      stage: 'vote' | 'revote';
      tally: Record<PlayerId, number>;
      abstained: number;
      outcome: 'condemned' | 'tie' | 'noVotes';
      leaders: PlayerId[];
    }
  | { kind: 'ballots'; ballots: Record<PlayerId, PlayerId | null> }
  | { kind: 'revote'; candidates: PlayerId[] }
  | { kind: 'noExecution'; reason: 'noVotes' | 'tie' }
  | { kind: 'prevented'; target: PlayerId }
  | { kind: 'cancelled'; target: PlayerId }
  | { kind: 'personalWin'; player: PlayerId; role: RoleId | null }
  | { kind: 'gameEnded'; result: GameResult };

export interface Report {
  /** Что видят все. */
  public: Beat[];
  /** Что касается только этого игрока (результаты проверок, сцены «Кино»). */
  private: Beat[];
}

const PHASE_MARKERS = new Set(['nightStarted', 'dayStarted']);

/**
 * События отрезка партии: после последнего маркера `marker` и до следующего маркера фазы.
 * Утром — итоги ночи (`nightStarted`), вечером — итоги дня (`dayStarted`).
 */
export function segment(events: readonly ViewEvent[], marker: 'nightStarted' | 'dayStarted'): ViewEvent[] {
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if ((events[i] as ViewEvent).type === marker) {
      start = i;
      break;
    }
  }
  const out: ViewEvent[] = [];
  for (let i = start + 1; i < events.length; i++) {
    const event = events[i] as ViewEvent;
    if (PHASE_MARKERS.has(event.type)) break;
    out.push(event);
  }
  return out;
}

/** Какой фазой закончилась партия: последний маркер фазы в журнале. */
export function lastPhaseMarker(events: readonly ViewEvent[]): 'nightStarted' | 'dayStarted' {
  for (let i = events.length - 1; i >= 0; i--) {
    const type = (events[i] as ViewEvent).type;
    if (type === 'nightStarted' || type === 'dayStarted') return type;
  }
  return 'nightStarted';
}

/**
 * Пересказать отрезок событий для зрителя `me` (null — ведущий или общий экран).
 * Сцены «Кино» добавляются к личному, если они относятся к этому отрезку.
 */
export function digest(
  events: readonly ViewEvent[],
  options: { me: PlayerId | null; scenes?: readonly Scene[]; night?: boolean },
): Report {
  const { me, scenes = [], night = false } = options;
  const pub: Beat[] = [];
  const priv: Beat[] = [];
  const deaths = new Map<PlayerId, Extract<Beat, { kind: 'death' }>>();

  for (const event of events) {
    switch (event.type) {
      case 'death': {
        const player = event.targets[0];
        if (!player) break;
        const beat: Extract<Beat, { kind: 'death' }> = {
          kind: 'death',
          player,
          cause: event.data.cause ?? null,
          role: null,
          by: event.redacted ? [] : event.actors,
        };
        deaths.set(player, beat);
        pub.push(beat);
        break;
      }
      case 'roleRevealed': {
        const player = event.targets[0];
        const role = event.data.role;
        if (!player || !role) break;
        const death = deaths.get(player);
        if (death) death.role = role;
        else pub.push({ kind: 'roleRevealed', player, role });
        break;
      }
      case 'saved': {
        const mine = !event.redacted && me !== null && event.actors.includes(me);
        const beat: Beat = {
          kind: 'saved',
          target: event.redacted ? null : (event.targets[0] ?? null),
          by: event.data.by ?? null,
          mine,
        };
        if (mine) priv.push(beat);
        else pub.push({ kind: 'saved', target: null, by: null, mine: false });
        break;
      }
      case 'silenced': {
        const player = event.targets[0];
        if (player) pub.push({ kind: 'silenced', player });
        break;
      }
      case 'blocked':
        if (event.redacted) priv.push({ kind: 'blockedMe' });
        else if (event.targets[0]) priv.push({ kind: 'myAction', ability: 'block', targets: event.targets });
        break;
      case 'abilityUsed':
        // свой ход — напоминание «что вы сделали ночью» (блокировку описывает событие blocked)
        if (!event.redacted && me !== null && event.actors.includes(me) && event.data.ability && event.data.ability !== 'block') {
          priv.push({ kind: 'myAction', ability: event.data.ability, targets: event.targets });
        }
        break;
      case 'checked': {
        const target = event.targets[0];
        if (target && event.data.isMafia !== undefined) priv.push({ kind: 'checked', target, isMafia: event.data.isMafia });
        break;
      }
      case 'roleLearned': {
        const target = event.targets[0];
        if (target && event.data.role) {
          priv.push({ kind: 'roleLearned', target, role: event.data.role, byTeam: me !== null && !event.actors.includes(me) });
        }
        break;
      }
      case 'visitorsSeen': {
        const target = event.targets[0];
        if (target) priv.push({ kind: 'visitors', target, visitors: event.data.visitors ?? [] });
        break;
      }
      case 'teamsCompared':
        if (event.data.sameTeam !== undefined) priv.push({ kind: 'compared', targets: event.targets, sameTeam: event.data.sameTeam });
        break;
      case 'loversLinked':
        priv.push({ kind: 'lovers', targets: event.targets });
        break;
      case 'mafiaTargetChosen':
        priv.push({ kind: 'mafiaTarget', target: event.targets[0] ?? null, decidedBy: event.data.decidedBy ?? null });
        break;
      case 'covered':
        if (event.targets[0]) priv.push({ kind: 'covered', target: event.targets[0] });
        break;
      case 'blessed':
        if (event.targets[0]) priv.push({ kind: 'blessedBy', target: event.targets[0] });
        break;
      case 'voteResult':
        if (event.data.stage && event.data.tally && event.data.outcome) {
          pub.push({
            kind: 'voteResult',
            stage: event.data.stage,
            tally: event.data.tally,
            abstained: event.data.abstained ?? 0,
            outcome: event.data.outcome,
            leaders: event.targets,
          });
        }
        break;
      case 'ballotsRevealed':
        if (event.data.ballots) pub.push({ kind: 'ballots', ballots: event.data.ballots });
        break;
      case 'revoteStarted':
        pub.push({ kind: 'revote', candidates: event.targets });
        break;
      case 'noExecution':
        if (event.data.reason) pub.push({ kind: 'noExecution', reason: event.data.reason });
        break;
      case 'executionPrevented':
        if (event.targets[0]) pub.push({ kind: 'prevented', target: event.targets[0] });
        break;
      case 'voteCancelled':
        if (event.targets[0]) pub.push({ kind: 'cancelled', target: event.targets[0] });
        break;
      case 'personalWin':
        if (event.targets[0]) pub.push({ kind: 'personalWin', player: event.targets[0], role: event.data.role ?? null });
        break;
      case 'gameEnded':
        if (event.data.outcome && event.data.reason && event.data.winners) {
          pub.push({
            kind: 'gameEnded',
            result: { outcome: event.data.outcome, reason: event.data.reason, winners: event.data.winners },
          });
        }
        break;
      default:
        break;
    }
  }

  if (night && !pub.some((b) => b.kind === 'death')) pub.unshift({ kind: 'quietNight' });

  // сцены «Кино» — их отбирает вызывающий (scenesOfRound): событие abilityUsed цели не видно
  for (const scene of scenes) priv.push({ kind: 'scene', scene });
  return { public: pub, private: priv };
}

/** Сцены, относящиеся к ночи `round`. */
export function scenesOfRound(scenes: readonly Scene[], round: number): Scene[] {
  return scenes.filter((s) => s.round === round);
}
