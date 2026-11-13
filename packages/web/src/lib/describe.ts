/**
 * События и такты — человеческим языком. Только пересказ того, что прислал сервер.
 */
import type { PlayerId, RoleId, ViewEvent } from '@mafia/engine';
import { roleName, t } from '../i18n';
import type { Beat } from '../presenter/digest';

export type NameOf = (id: PlayerId) => string;

function list(ids: readonly PlayerId[], name: NameOf): string {
  return ids.map(name).join(', ');
}

/** Тон строки: для подсветки в журнале и отчётах. */
export type Tone = 'death' | 'save' | 'info' | 'private' | 'vote' | 'win' | 'plain';

export interface Line {
  text: string;
  tone: Tone;
}

/** Строка журнала для события; null — событие служебное и в журнал не идёт. */
export function describeEvent(event: ViewEvent, name: NameOf): Line | null {
  const target = event.targets[0];
  const who = target ? name(target) : '';
  switch (event.type) {
    case 'gameStarted':
      return { text: `Партия началась: ${t.common.players(event.data.playerCount ?? 0)}.`, tone: 'plain' };
    case 'roleAssigned':
      return event.data.role ? { text: `Ваша роль — ${roleName(event.data.role)}.`, tone: 'private' } : null;
    case 'teamRevealed': {
      const roles = event.data.roles ?? {};
      const members = Object.entries(roles).map(([id, role]) => `${name(id)} (${roleName(role as RoleId)})`);
      return { text: `Чёрная команда: ${members.join(', ')}.`, tone: 'private' };
    }
    case 'nightStarted':
    case 'dayStarted':
      return null;
    case 'abilityUsed': {
      const ability = event.data.ability;
      if (!ability || event.redacted) return null;
      const actor = event.actors[0] ? name(event.actors[0]) : '';
      return { text: `Ход ${actor}: ${t.abilities[ability].label.toLowerCase()} → ${list(event.targets, name)}.`, tone: 'private' };
    }
    case 'loversLinked':
      return event.redacted
        ? { text: `Купидон связал судьбы: ${list(event.targets, name)}.`, tone: 'private' }
        : { text: `Вы связали судьбы: ${list(event.targets, name)}.`, tone: 'private' };
    case 'blocked':
      return event.redacted
        ? { text: 'Этой ночью вашу способность заблокировали.', tone: 'private' }
        : { text: `Вы провели ночь с игроком ${who}.`, tone: 'private' };
    case 'blessed':
      return { text: `${who} под благословением на завтра.`, tone: 'private' };
    case 'mafiaTargetChosen':
      return { text: `Мафия выбрала жертву: ${who || 'никого'}.`, tone: 'private' };
    case 'saved':
      if (event.redacted) return { text: 'Кого-то этой ночью спасли.', tone: 'save' };
      return {
        text: `Спасение: ${who}${event.data.by ? ` (${t.saveKinds[event.data.by]})` : ''}.`,
        tone: 'save',
      };
    case 'death': {
      const cause = event.data.cause ? t.deathCauses[event.data.cause] : 'смерть';
      const by = !event.redacted && event.actors.length > 0 ? ` (${list(event.actors, name)})` : '';
      return { text: `${who} выбывает: ${cause}${by}.`, tone: 'death' };
    }
    case 'roleRevealed':
      return event.data.role ? { text: `Роль игрока ${who}: ${roleName(event.data.role)}.`, tone: 'info' } : null;
    case 'covered':
      return { text: `Адвокат прикрыл игрока ${who}.`, tone: 'private' };
    case 'silenced':
      return { text: `${who} молчит на следующем обсуждении.`, tone: 'info' };
    case 'checked':
      return {
        text: `Проверка: ${who} — ${event.data.isMafia ? 'мафия' : 'не мафия'}.`,
        tone: 'private',
      };
    case 'roleLearned':
      return event.data.role ? { text: `Разведано: ${who} — ${roleName(event.data.role)}.`, tone: 'private' } : null;
    case 'visitorsSeen': {
      const visitors = event.data.visitors ?? [];
      return {
        text: visitors.length > 0 ? `К игроку ${who} приходили: ${list(visitors, name)}.` : `К игроку ${who} никто не приходил.`,
        tone: 'private',
      };
    }
    case 'teamsCompared':
      return {
        text: `${list(event.targets, name)}: ${event.data.sameTeam ? 'в одной команде' : 'в разных командах'}.`,
        tone: 'private',
      };
    case 'voteResult': {
      const tally = event.data.tally ?? {};
      const parts = Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${name(id)} — ${n}`);
      const head = event.data.stage === 'revote' ? 'Переголосование' : 'Голосование';
      return { text: `${head}: ${parts.length > 0 ? parts.join(', ') : 'голосов нет'}.`, tone: 'vote' };
    }
    case 'ballotsRevealed': {
      const ballots = event.data.ballots ?? {};
      const parts = Object.entries(ballots).map(([voter, choice]) => `${name(voter)} → ${choice ? name(choice) : 'воздержание'}`);
      return { text: `Голоса: ${parts.join('; ')}.`, tone: 'vote' };
    }
    case 'revoteStarted':
      return { text: `Ничья — переголосование между: ${list(event.targets, name)}.`, tone: 'vote' };
    case 'noExecution':
      return {
        text: event.data.reason === 'tie' ? 'Голоса разделились — казни нет.' : 'Никто не голосовал — казни нет.',
        tone: 'vote',
      };
    case 'executionPrevented':
      return { text: `Благословение спасло игрока ${who} от казни.`, tone: 'save' };
    case 'voteCancelled':
      return { text: `Казнь игрока ${who} отменена.`, tone: 'save' };
    case 'personalWin':
      return { text: `Личная победа: ${who}${event.data.role ? ` (${roleName(event.data.role)})` : ''}!`, tone: 'win' };
    case 'gameEnded':
      return event.data.outcome ? { text: `${t.outcomes[event.data.outcome].title}.`, tone: 'win' } : null;
    default:
      return null;
  }
}

/** Строка такта для отчётов (утро, вечер). */
export function describeBeat(beat: Beat, name: NameOf): Line | null {
  switch (beat.kind) {
    case 'death': {
      const cause = beat.cause ? t.deathCauses[beat.cause] : 'смерть';
      const role = beat.role ? ` Роль: ${roleName(beat.role)}.` : '';
      const by = beat.by.length > 0 ? ` (${list(beat.by, name)})` : '';
      return { text: `${name(beat.player)} — ${cause}${by}.${role}`, tone: 'death' };
    }
    case 'quietNight':
      return { text: t.game.morning.nobodyDied, tone: 'save' };
    case 'saved':
      return beat.mine && beat.target
        ? { text: `Вы спасли игрока ${name(beat.target)}.`, tone: 'save' }
        : { text: t.game.morning.someoneSaved, tone: 'save' };
    case 'silenced':
      return { text: t.game.morning.silenced(name(beat.player)), tone: 'info' };
    case 'roleRevealed':
      return { text: `${name(beat.player)} — ${roleName(beat.role)}.`, tone: 'info' };
    case 'blockedMe':
      return { text: 'Этой ночью вас заблокировали — способность не сработала.', tone: 'private' };
    case 'myAction': {
      const label = t.abilities[beat.ability].label.toLowerCase();
      return { text: `Ваш ход: ${label} — ${list(beat.targets, name)}.`, tone: 'private' };
    }
    case 'checked':
      return {
        text: `${name(beat.target)} — ${beat.isMafia ? 'МАФИЯ' : 'не мафия'}.`,
        tone: 'private',
      };
    case 'roleLearned':
      return {
        text: `${beat.byTeam ? 'Консильери узнал' : 'Вы узнали'}: ${name(beat.target)} — ${roleName(beat.role)}.`,
        tone: 'private',
      };
    case 'visitors':
      return {
        text:
          beat.visitors.length > 0
            ? `К игроку ${name(beat.target)} приходили: ${list(beat.visitors, name)}.`
            : `К игроку ${name(beat.target)} никто не приходил.`,
        tone: 'private',
      };
    case 'compared':
      return {
        text: `${list(beat.targets, name)} — ${beat.sameTeam ? 'в одной команде' : 'в разных командах'}.`,
        tone: 'private',
      };
    case 'lovers':
      return { text: `Купидон связал судьбы: ${list(beat.targets, name)}.`, tone: 'private' };
    case 'mafiaTarget':
      return { text: `Мафия выбрала: ${beat.target ? name(beat.target) : 'никого'}.`, tone: 'private' };
    case 'covered':
      return { text: `Адвокат прикрыл игрока ${name(beat.target)}.`, tone: 'private' };
    case 'blessedBy':
      return { text: `${name(beat.target)} под вашим благословением на завтра.`, tone: 'private' };
    case 'scene': {
      const role = roleName(beat.scene.role);
      const scenes = t.game.scenes as Record<string, ((role: string, saved: boolean) => string) | undefined>;
      const fn = scenes[beat.scene.ability] ?? t.game.scenes.generic;
      return { text: fn(role, beat.scene.saved), tone: beat.scene.saved ? 'save' : 'private' };
    }
    case 'voteResult':
      return null; // рисуется отдельно: столбцы голосов
    case 'ballots':
      return null;
    case 'revote':
      return { text: t.game.evening.revote, tone: 'vote' };
    case 'noExecution':
      return { text: beat.reason === 'tie' ? t.game.evening.tie : t.game.evening.noVotes, tone: 'vote' };
    case 'prevented':
      return { text: t.game.evening.blessed(name(beat.target)), tone: 'save' };
    case 'cancelled':
      return { text: t.game.evening.cancelled(name(beat.target)), tone: 'save' };
    case 'personalWin':
      return { text: t.game.evening.personalWin(name(beat.player), beat.role ? roleName(beat.role) : '?'), tone: 'win' };
    case 'gameEnded':
      return { text: t.outcomes[beat.result.outcome].title, tone: 'win' };
    default:
      return null;
  }
}
