/**
 * «Мозг» бота: по снимку партии решает, какое сообщение отправить.
 * Чистая функция без сети — используется и в интеграционных тестах, и в скрипте `npm run bots`.
 * Бот знает ровно то, что знает обычный клиент: свой снимок.
 */
import type { ClientMessage, GameSnapshot } from '@mafia/protocol';

/** Источник случайности: число в [0, 1). */
export type Random = () => number;

/** Простой воспроизводимый генератор (mulberry32) для ботов. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function shuffled<T>(random: Random, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export interface BotMemory {
  /** Шаг, на котором бот уже отправил «готов». */
  readyStep: number;
  /** Круг, в котором бот-мафиози уже написал в чат. */
  chatRound: number;
  /** Шаг, на котором бот-хост уже открыл голосование. */
  voteStep: number;
}

export function newBotMemory(): BotMemory {
  return { readyStep: -1, chatRound: 0, voteStep: -1 };
}

const CHAT_LINES = ['кого берём?', 'предлагаю того, кто слева', 'только не меня', 'согласен', 'тихо, за нами следят'];

/**
 * Следующее сообщение бота или null, если сейчас от него ничего не требуется.
 * После отправки сообщения функцию вызывают снова — уже с новым снимком.
 */
export function botMove(
  game: GameSnapshot,
  memory: BotMemory,
  random: Random,
  options: { isHost?: boolean } = {},
): ClientMessage | null {
  const view = game.view;

  // обсуждение днём: голосование открывает хост
  if (game.stage === 'discussion') {
    if (!options.isHost || memory.voteStep === game.step) return null;
    memory.voteStep = game.step;
    return { t: 'advance', step: game.step };
  }

  // утро и вечер: клиент «досмотрел» итоги ночи или приговор
  if (game.stage === 'morning' || game.stage === 'evening') {
    if (memory.readyStep === game.step) return null;
    memory.readyStep = game.step;
    return { t: 'ready', step: game.step };
  }

  // решение ждут именно от нас
  if (game.stage === 'decision') {
    const decision = view.decision;
    if (!decision) return null;
    if (decision.kind === 'hunterShot') {
      const target = random() < 0.8 && decision.options.length > 0 ? pick(random, decision.options) : null;
      return { t: 'decision', decision: { kind: 'hunterShot', target } };
    }
    if (decision.kind === 'bomberBlast') {
      return { t: 'decision', decision: { kind: 'bomberBlast', target: pick(random, decision.options) } };
    }
    return { t: 'decision', decision: { kind: 'judgeVeto', veto: random() < 0.5 } };
  }

  if (!view.you || !view.you.alive) return null;

  if (game.stage === 'night' && view.night) {
    const { options, submitted } = view.night;
    if (!options) return null;
    // мафия иногда переговаривается в ночном чате (не чаще раза за ночь)
    if (view.you.team === 'black' && memory.chatRound !== view.round && random() < 0.5) {
      memory.chatRound = view.round;
      return { t: 'chat', text: pick(random, CHAT_LINES) };
    }
    if (options.abilities.length > 0 && submitted.ability === undefined) {
      if (random() < 0.85) {
        const option = pick(random, options.abilities);
        const targets = shuffled(random, option.candidates).slice(0, option.targets);
        return { t: 'night', action: { kind: 'ability', ability: option.id, targets } };
      }
      return { t: 'night', action: { kind: 'pass' } };
    }
    if (options.mafiaVote && submitted.mafiaVote === undefined) {
      const target = random() < 0.9 && options.mafiaVote.candidates.length > 0 ? pick(random, options.mafiaVote.candidates) : null;
      return { t: 'night', action: { kind: 'mafiaVote', target } };
    }
    // «пустой» ход: делать нечего, но ход сделать нужно
    if (options.abilities.length === 0 && !options.mafiaVote && submitted.ability === undefined) {
      return { t: 'night', action: { kind: 'pass' } };
    }
    return null;
  }

  if (game.stage === 'day' && view.day) {
    if (!view.day.canVote || view.day.myVote !== undefined) return null;
    const pool = (view.day.candidates ?? view.players.filter((p) => p.alive).map((p) => p.id)).filter(
      (id) => id !== view.you?.id,
    );
    const target = pool.length > 0 && random() < 0.85 ? pick(random, pool) : null;
    return { t: 'vote', target };
  }
  return null;
}
