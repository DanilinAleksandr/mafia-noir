import type { GameConfig, GameConfigInput, Rules } from './types';

export const DEFAULT_RULES: Rules = {
  revealRoleOnDeath: true,
  revealDeathCause: true,
  commissionerSeesDonAsMafia: true,
  commissionerSeesManiacAsMafia: false,
  mistressMode: 'neutral',
  deadSeeAllRoles: false,
  votingMode: 'secret',
  jesterWinEndsGame: false,
  announceSaves: true,
  doctorSelfHeal: true,
};

/** Минимальное число игроков. */
export const MIN_PLAYERS = 4;

/** Доля красных мест для Мирных жителей по умолчанию и число игроков, с которого она действует. */
export const DEFAULT_CIVILIANS_SHARE = 0.3;
export const CIVILIANS_SHARE_FROM_PLAYERS = 8;

/** Заполняет пропуски в конфиге значениями по умолчанию. Результат — обычный JSON. */
export function resolveConfig(input: GameConfigInput = {}): GameConfig {
  return {
    rules: { ...DEFAULT_RULES, ...(input.rules ?? {}) },
    composition: {
      roles: { ...(input.composition?.roles ?? {}) },
      quotas: { ...(input.composition?.quotas ?? {}) },
      preset: input.composition?.preset ? [...input.composition.preset] : null,
      minCiviliansShare: input.composition?.minCiviliansShare ?? null,
    },
  };
}
