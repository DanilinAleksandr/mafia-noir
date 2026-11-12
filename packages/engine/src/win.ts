/**
 * Условия победы.
 */
import { winOf } from './roles';
import type { GameResult, GameState, Outcome, PlayerId, WinReason } from './types';

function buildResult(state: GameState, outcome: Outcome, reason: WinReason): GameResult {
  const rules = state.config.rules;
  const winners = new Set<PlayerId>();
  for (const p of state.players) {
    const win = winOf(p.role, rules);
    if (outcome === 'red' && win === 'team' && p.team === 'red') winners.add(p.id);
    if (outcome === 'black' && win === 'team' && p.team === 'black') winners.add(p.id);
    if (outcome === 'maniac' && win === 'maniac' && p.alive) winners.add(p.id);
    // «выжить» засчитывается при любом исходе
    if (win === 'survive' && p.alive) winners.add(p.id);
  }
  // личные победы (казнённые Шут и Подрывник) засчитываются при любом исходе
  for (const id of state.personalWinners) winners.add(id);
  // порядок — по местам за столом
  return { outcome, reason, winners: state.players.filter((p) => winners.has(p.id)).map((p) => p.id) };
}

/**
 * Проверить, закончилась ли игра. Возвращает итог или null, если игра продолжается.
 *
 * - красные: мертвы все мафиози и маньяк;
 * - чёрные: мафиози не меньше остальных живых; пока жив маньяк — строго больше;
 * - маньяк: мафии нет, а в живых он один или вдвоём с кем-то;
 * - ничья: все мертвы либо остались один мафиози и маньяк.
 */
export function checkWin(state: GameState): GameResult | null {
  if (state.result) return state.result;
  const rules = state.config.rules;

  if (rules.jesterWinEndsGame) {
    const jesterWon = state.personalWinners.some(
      (id) => state.players.find((p) => p.id === id)?.role === 'jester',
    );
    if (jesterWon) return buildResult(state, 'jester', 'jesterExecuted');
  }

  const alive = state.players.filter((p) => p.alive);
  const black = alive.filter((p) => p.team === 'black').length;
  const maniacs = alive.filter((p) => winOf(p.role, rules) === 'maniac').length;
  const others = alive.length - black;

  if (alive.length === 0) return buildResult(state, 'draw', 'everyoneDead');
  if (black === 0 && maniacs === 0) return buildResult(state, 'red', 'threatsEliminated');
  if (black === 0) {
    return alive.length <= 2 ? buildResult(state, 'maniac', 'maniacLastStanding') : null;
  }
  if (maniacs > 0) {
    if (black === 1 && alive.length === 2) return buildResult(state, 'draw', 'mafiaManiacStandoff');
    return black > others ? buildResult(state, 'black', 'mafiaParity') : null;
  }
  return black >= others ? buildResult(state, 'black', 'mafiaParity') : null;
}
