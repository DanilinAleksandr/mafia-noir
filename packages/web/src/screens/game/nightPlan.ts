/**
 * Что делается в общей ночной панели, а что — в «Блокноте».
 *
 * Общая панель у всех ролей одинакова и по виду, и по тексту: «Выберите игрока», сетка,
 * «Пропустить» и «Сделать ход». Что именно означает выбор, знает только код:
 *  - у чёрных — голос мафии за жертву (собственная способность — в «Блокноте»);
 *  - у ролей со способностью — способность (у Ведьмы зелье выбирается в «Блокноте»);
 *  - у остальных — заметка для себя, на сервер уходит «пустой» ход.
 */
import type { AbilityId, AbilityOption, NightEntry, NightOptions, PlayerId } from '@mafia/engine';

export type MainMove =
  | { kind: 'vote'; candidates: PlayerId[]; need: 1 }
  | { kind: 'ability'; option: AbilityOption; candidates: PlayerId[]; need: 1 | 2 }
  | { kind: 'plain'; candidates: PlayerId[]; need: 1 };

export function mainMove(
  options: NightOptions,
  choice: AbilityId | null,
  alive: readonly PlayerId[],
  me: PlayerId,
): MainMove {
  if (options.mafiaVote) return { kind: 'vote', candidates: options.mafiaVote.candidates, need: 1 };
  const option = options.abilities.find((o) => o.id === choice) ?? options.abilities[0];
  if (option) return { kind: 'ability', option, candidates: option.candidates, need: option.targets };
  return { kind: 'plain', candidates: alive.filter((id) => id !== me), need: 1 };
}

/** Сделан ли ход общей панели. */
export function mainDone(move: MainMove, submitted: NightEntry): boolean {
  return move.kind === 'vote' ? submitted.mafiaVote !== undefined : submitted.ability !== undefined;
}

/** Способности, которые выполняются в «Блокноте» (у чёрных — своя способность вдобавок к голосу). */
export function sideAbilities(options: NightOptions): AbilityOption[] {
  return options.mafiaVote ? options.abilities : [];
}
