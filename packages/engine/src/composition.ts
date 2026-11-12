/**
 * Генератор состава: раскладывает роли по слотам так, чтобы выполнялись квоты по категориям.
 */
import { CIVILIANS_SHARE_FROM_PLAYERS, DEFAULT_CIVILIANS_SHARE, MIN_PLAYERS, resolveConfig } from './config';
import { createRng, seedToState } from './rng';
import { ROLE_LIST, ROLES, categoryOf, isRoleId, teamOf } from './roles';
import type { Category, GameConfigInput, Quota, QuotaKey, RoleId, Rules } from './types';
import { ROLE_IDS } from './types';

export type CompositionIssueCode =
  | 'TOO_FEW_PLAYERS'
  | 'QUOTA_INVALID'
  | 'QUOTA_UNSATISFIABLE'
  | 'RED_QUOTA_CONFLICT'
  | 'TOO_MANY_REQUIRED'
  | 'NOT_ENOUGH_ROLES'
  | 'PRESET_INVALID'
  | 'NO_BLACK'
  | 'BLACK_NOT_MINORITY'
  | 'ROLE_USELESS'
  | 'NO_INFO_ROLES'
  | 'ROLE_SKIPPED'
  | 'SHARE_INVALID'
  | 'CIVILIAN_SHARE_UNMET';

export interface CompositionIssue {
  code: CompositionIssueCode;
  /** Понятное человеку объяснение по-русски. */
  message: string;
  /** К какой квоте относится. */
  key?: QuotaKey;
  role?: RoleId;
}

export type CompositionResult =
  | {
      ok: true;
      /** Роли в порядке каталога (по местам их раскладывает createGame). */
      roles: RoleId[];
      counts: Record<Category, number>;
      warnings: CompositionIssue[];
    }
  | { ok: false; errors: CompositionIssue[] };

const LEAVES: Category[] = ['black', 'neutral', 'redInfo', 'redDefense', 'redActive', 'redPlain'];
const RED_LEAVES: Category[] = ['redInfo', 'redDefense', 'redActive', 'redPlain'];

export const CATEGORY_LABELS: Record<QuotaKey, string> = {
  red: 'Красные',
  redInfo: 'Красные информационные',
  redDefense: 'Красные защитные',
  redActive: 'Красные активные',
  redPlain: 'Мирные жители',
  black: 'Чёрные',
  neutral: 'Нейтральные',
};

/** Сколько чёрных ставится по умолчанию, если квота не задана. */
export function defaultBlackCount(playerCount: number): number {
  return Math.max(1, Math.floor((playerCount - 1) / 3));
}

/** Сколько нейтральных допускается по умолчанию, если квота не задана. */
export function defaultNeutralMax(playerCount: number): number {
  return Math.floor(playerCount / 5);
}

function emptyCounts(): Record<Category, number> {
  return { redInfo: 0, redDefense: 0, redActive: 0, redPlain: 0, black: 0, neutral: 0 };
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(n) : 'без ограничения';
}

/**
 * Проверки готового состава: баланс (ошибки) и подсказки (предупреждения).
 * Используется и генератором, и для состава, собранного хостом вручную.
 */
export function validateComposition(
  roles: readonly RoleId[],
  rules: Rules,
): { errors: CompositionIssue[]; warnings: CompositionIssue[]; counts: Record<Category, number> } {
  const errors: CompositionIssue[] = [];
  const warnings: CompositionIssue[] = [];
  const counts = emptyCounts();
  for (const r of roles) counts[categoryOf(r, rules)]++;
  const n = roles.length;

  if (n < MIN_PLAYERS) {
    errors.push({
      code: 'TOO_FEW_PLAYERS',
      message: `Нужно минимум ${MIN_PLAYERS} игрока, а в составе ${n}`,
    });
  }
  const black = roles.filter((r) => teamOf(r, rules) === 'black').length;
  if (black === 0) {
    errors.push({ code: 'NO_BLACK', key: 'black', message: 'В составе нет ни одного чёрного: играть не с кем' });
  }
  if (black > 0 && black >= n - black) {
    errors.push({
      code: 'BLACK_NOT_MINORITY',
      key: 'black',
      message: `Чёрных (${black}) должно быть меньше, чем остальных (${n - black}), иначе мафия побеждает сразу`,
    });
  }

  for (const r of new Set(roles)) {
    const missing = ROLES[r].needs.filter((need) => !roles.includes(need));
    if (missing.length > 0) {
      warnings.push({
        code: 'ROLE_USELESS',
        role: r,
        message: `${ROLES[r].name} бесполезен без роли: ${missing.map((m) => ROLES[m].name).join(', ')}`,
      });
    }
  }
  if (n >= 6 && counts.redInfo === 0) {
    warnings.push({
      code: 'NO_INFO_ROLES',
      key: 'redInfo',
      message: 'У красных нет ни одной информационной роли: мирным будет трудно',
    });
  }
  return { errors, warnings, counts };
}

interface Bounds {
  lo: number;
  hi: number;
}

function normalizeQuota(
  key: QuotaKey,
  quota: Quota | undefined,
  errors: CompositionIssue[],
): { min: number | undefined; max: number | undefined } {
  if (!quota) return { min: undefined, max: undefined };
  const min = quota.exact ?? quota.min;
  const max = quota.exact ?? quota.max;
  for (const v of [min, max]) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
      errors.push({
        code: 'QUOTA_INVALID',
        key,
        message: `${CATEGORY_LABELS[key]}: квота должна быть целым неотрицательным числом`,
      });
      return { min: undefined, max: undefined };
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    errors.push({
      code: 'QUOTA_INVALID',
      key,
      message: `${CATEGORY_LABELS[key]}: минимум (${min}) больше максимума (${max})`,
    });
    return { min: undefined, max: undefined };
  }
  return { min, max };
}

/**
 * Сгенерировать состав на playerCount игроков.
 *
 * 1. Минимумы квот закрываются случайными ролями соответствующих категорий.
 * 2. Остаток добирается случайными включёнными ролями со свободным лимитом (в пределах максимумов квот),
 *    а когда такие кончаются — Мирными жителями.
 * 3. Если квоты выполнить нельзя, возвращается список ошибок с объяснением, что именно не сходится.
 */
export function generateComposition(
  playerCount: number,
  config: GameConfigInput = {},
  seed: string | number = 0,
): CompositionResult {
  const cfg = resolveConfig(config);
  const rules = cfg.rules;
  const n = playerCount;
  const errors: CompositionIssue[] = [];

  if (!Number.isInteger(n) || n < MIN_PLAYERS) {
    return {
      ok: false,
      errors: [{ code: 'TOO_FEW_PLAYERS', message: `Нужно минимум ${MIN_PLAYERS} игрока, а игроков ${n}` }],
    };
  }

  // ── состав задан хостом вручную ──
  if (cfg.composition.preset) {
    const preset = cfg.composition.preset;
    const unknown = preset.filter((r) => !isRoleId(r));
    if (unknown.length > 0) {
      return {
        ok: false,
        errors: [{ code: 'PRESET_INVALID', message: `Неизвестные роли в составе: ${unknown.join(', ')}` }],
      };
    }
    if (preset.length !== n) {
      return {
        ok: false,
        errors: [
          { code: 'PRESET_INVALID', message: `В составе ${preset.length} ролей, а игроков ${n}` },
        ],
      };
    }
    const check = validateComposition(preset, rules);
    if (check.errors.length > 0) return { ok: false, errors: check.errors };
    const roles = [...preset].sort((a, b) => ROLE_IDS.indexOf(a) - ROLE_IDS.indexOf(b));
    return { ok: true, roles, counts: check.counts, warnings: check.warnings };
  }

  // ── доля Мирных жителей ──
  const rawShare = cfg.composition.minCiviliansShare;
  if (rawShare !== null && (typeof rawShare !== 'number' || !(rawShare >= 0 && rawShare <= 1))) {
    return {
      ok: false,
      errors: [
        {
          code: 'SHARE_INVALID',
          key: 'redPlain',
          message: 'Доля Мирных жителей должна быть числом от 0 до 1',
        },
      ],
    };
  }
  const share = effectiveCiviliansShare(n, rawShare);
  /** Сколько Мирных нужно при данном числе красных мест. */
  const civiliansTarget = (redTotal: number): number => Math.round(share * redTotal);

  // ── какие роли доступны и сколько копий ──
  const warnings: CompositionIssue[] = [];
  const settings = cfg.composition.roles;
  const isEnabled = (id: RoleId): boolean => {
    const s = settings[id];
    if (s?.enabled === false) return false;
    const max = s?.max === undefined ? ROLES[id].maxCopies : s.max;
    return max === null || max > 0;
  };
  const limit: Partial<Record<RoleId, number>> = {};
  const pools: Record<Category, RoleId[]> = {
    redInfo: [],
    redDefense: [],
    redActive: [],
    redPlain: [],
    black: [],
    neutral: [],
  };
  for (const def of ROLE_LIST) {
    if (!isEnabled(def.id)) continue;
    const missing = def.needs.filter((need) => !isEnabled(need));
    if (missing.length > 0) {
      warnings.push({
        code: 'ROLE_SKIPPED',
        role: def.id,
        message: `${def.name} не попадёт в состав: выключена роль ${missing.map((m) => ROLES[m].name).join(', ')}`,
      });
      continue;
    }
    const s = settings[def.id];
    const max = s?.max === undefined ? def.maxCopies : s.max;
    limit[def.id] = max === null ? Infinity : max;
    pools[categoryOf(def.id, rules)].push(def.id);
  }
  const capacity = (cat: Category): number => pools[cat].reduce((sum, id) => sum + (limit[id] ?? 0), 0);

  // ── границы по категориям ──
  const quotas = cfg.composition.quotas;
  const bounds = {} as Record<Category, Bounds>;
  const balanceCap = Math.ceil(n / 2) - 1; // чёрных должно быть меньше остальных

  for (const cat of LEAVES) {
    const q = normalizeQuota(cat, quotas[cat], errors);
    const cap = capacity(cat);
    let lo: number;
    let max: number;
    if (cat === 'black') {
      const def = defaultBlackCount(n);
      if (!quotas.black) {
        // по умолчанию — ровно рекомендованное число, но не больше, чем есть ролей
        lo = Math.min(def, cap);
        max = lo;
      } else {
        lo = q.min ?? Math.min(1, q.max ?? 1);
        max = q.max ?? Math.max(lo, def);
      }
      if (lo > balanceCap) {
        errors.push({
          code: 'BLACK_NOT_MINORITY',
          key: 'black',
          message: `Чёрные: по квоте нужно минимум ${lo}, но при ${n} игроках их может быть не больше ${balanceCap} — чёрных должно быть меньше, чем остальных`,
        });
        max = lo;
      } else {
        max = Math.min(max, balanceCap);
      }
    } else if (cat === 'neutral') {
      lo = q.min ?? 0;
      max = q.max ?? Math.max(lo, defaultNeutralMax(n));
    } else {
      lo = q.min ?? 0;
      max = q.max ?? Infinity;
    }
    const hi = Math.min(max, cap);
    if (lo > hi) {
      errors.push({
        code: cat === 'black' && cap === 0 ? 'NO_BLACK' : 'QUOTA_UNSATISFIABLE',
        key: cat,
        message:
          cap === 0
            ? `${CATEGORY_LABELS[cat]}: по квоте нужно минимум ${lo}, но в этой категории не включено ни одной роли`
            : `${CATEGORY_LABELS[cat]}: по квоте нужно минимум ${lo}, а включённые роли и их лимиты копий дают максимум ${fmt(cap)}`,
      });
    }
    bounds[cat] = { lo, hi };
  }
  if (bounds.black.hi === 0 && !errors.some((e) => e.key === 'black')) {
    errors.push({ code: 'NO_BLACK', key: 'black', message: 'Чёрные: не включено ни одной чёрной роли' });
  }

  const redQ = normalizeQuota('red', quotas.red, errors);
  const redLeafLo = RED_LEAVES.reduce((sum, c) => sum + bounds[c].lo, 0);
  const redLeafHi = RED_LEAVES.reduce((sum, c) => sum + bounds[c].hi, 0);
  const redLo = Math.max(redQ.min ?? 0, redLeafLo);
  const redHi = Math.min(redQ.max ?? Infinity, redLeafHi);
  if (errors.length === 0) {
    if (redQ.max !== undefined && redLeafLo > redQ.max) {
      errors.push({
        code: 'RED_QUOTA_CONFLICT',
        key: 'red',
        message: `Красные: минимумы по красным категориям в сумме дают ${redLeafLo}, а красных разрешено не больше ${redQ.max}`,
      });
    } else if (redLo > redHi) {
      errors.push({
        code: 'RED_QUOTA_CONFLICT',
        key: 'red',
        message: `Красные: по квоте нужно минимум ${redLo}, а включённые красные роли с учётом лимитов и максимумов дают не больше ${fmt(redHi)}`,
      });
    }
  }

  if (errors.length === 0) {
    const minTotal = redLo + bounds.black.lo + bounds.neutral.lo;
    const maxTotal = redHi + bounds.black.hi + bounds.neutral.hi;
    if (minTotal > n) {
      errors.push({
        code: 'TOO_MANY_REQUIRED',
        message: `Квоты требуют минимум ${minTotal} игроков (чёрные ${bounds.black.lo} + нейтральные ${bounds.neutral.lo} + красные ${redLo}), а игроков ${n}`,
      });
    } else if (maxTotal < n) {
      errors.push({
        code: 'NOT_ENOUGH_ROLES',
        message: `Квоты и лимиты ролей позволяют раздать максимум ${fmt(maxTotal)} ролей (чёрные ${fmt(bounds.black.hi)} + нейтральные ${fmt(bounds.neutral.hi)} + красные ${fmt(redHi)}), а игроков ${n}. Включите Мирного жителя, поднимите лимиты копий или ослабьте максимумы квот`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // ── раскладка ──
  const rng = createRng(seedToState(seed));
  const counts = emptyCounts();
  const taken: Partial<Record<RoleId, number>> = {};
  const roles: RoleId[] = [];
  const free = (id: RoleId): boolean => (taken[id] ?? 0) < (limit[id] ?? 0);
  const add = (id: RoleId): void => {
    roles.push(id);
    taken[id] = (taken[id] ?? 0) + 1;
    counts[categoryOf(id, rules)]++;
  };
  const redCount = (): number => RED_LEAVES.reduce((sum, c) => sum + counts[c], 0);

  // 1. минимумы
  for (const cat of LEAVES) {
    while (counts[cat] < bounds[cat].lo) {
      add(rng.pick(pools[cat].filter(free)));
    }
  }
  // 2. остаток: случайные особые роли, затем Мирные
  const specialIds = ROLE_LIST.map((d) => d.id).filter((id) => id !== 'civilian' && limit[id] !== undefined);
  while (roles.length < n) {
    const remaining = n - roles.length;
    const redNow = redCount();
    const redDeficit = Math.max(0, redLo - redNow);
    const fits = (id: RoleId): boolean => {
      const cat = categoryOf(id, rules);
      if (!free(id) || counts[cat] >= bounds[cat].hi) return false;
      const isRed = RED_LEAVES.includes(cat);
      // красным нужен запас под их минимум, красных не больше максимума
      return isRed ? redNow < redHi : remaining > redDeficit;
    };
    // Доля Мирных: особую роль берём, только если оставшихся мест ещё хватит Мирным.
    // Лучший для Мирных исход — отдать им все остальные места; если и его мало, роль не берём.
    const leavesRoomForCivilians = (id: RoleId): boolean => {
      if (share <= 0) return true;
      const isRed = RED_LEAVES.includes(categoryOf(id, rules));
      const redTotal = redNow + remaining - (isRed ? 0 : 1);
      return counts.redPlain + remaining - 1 >= civiliansTarget(redTotal);
    };
    const fitting = specialIds.filter(fits);
    const special = fitting.filter(leavesRoomForCivilians);
    const civilianFits = limit.civilian !== undefined && fits('civilian');
    if (special.length > 0) {
      add(rng.pick(special));
    } else if (civilianFits) {
      add('civilian');
    } else if (fitting.length > 0) {
      // Мирных добавить нельзя (выключены или упёрлись в квоту) — доля уступает квотам
      add(rng.pick(fitting));
    } else {
      // недостижимо после проверок выше; оставлено как страховка
      return {
        ok: false,
        errors: [
          {
            code: 'NOT_ENOUGH_ROLES',
            message: `Не удалось заполнить ${remaining} мест: не осталось ролей, подходящих под квоты`,
          },
        ],
      };
    }
  }

  // 3. роли с зависимостями: Адвокат бесполезен без Комиссара.
  //    Замены идут внутри одной категории, поэтому квоты и доля Мирных не нарушаются.
  const swap = (from: RoleId, to: RoleId): void => {
    roles[roles.indexOf(from)] = to;
    taken[from] = (taken[from] ?? 0) - 1;
    taken[to] = (taken[to] ?? 0) + 1;
  };
  const inComposition = (id: RoleId): boolean => (taken[id] ?? 0) > 0;
  const isNeeded = (id: RoleId): boolean => roles.some((r) => ROLES[r].needs.includes(id));
  for (const def of ROLE_LIST) {
    if (!inComposition(def.id)) continue;
    for (const need of def.needs) {
      if (inComposition(need)) continue;
      // а) нужная роль встаёт на место другой роли своей категории
      const needCat = categoryOf(need, rules);
      const replaceable = [...new Set(roles)].filter(
        (r) => categoryOf(r, rules) === needCat && ROLES[r].needs.length === 0 && !isNeeded(r),
      );
      if (free(need) && replaceable.length > 0) {
        swap(rng.pick(replaceable), need);
        continue;
      }
      // б) иначе сама роль уступает место другой роли своей категории
      const ownCat = categoryOf(def.id, rules);
      const alternatives = pools[ownCat].filter(
        (r) => r !== def.id && free(r) && ROLES[r].needs.every(inComposition),
      );
      if (alternatives.length > 0) {
        swap(def.id, rng.pick(alternatives));
        break;
      }
      // в) заменить нечем — роль остаётся, validateComposition добавит предупреждение
    }
  }

  const check = validateComposition(roles, rules);
  if (check.errors.length > 0) return { ok: false, errors: check.errors };
  const wanted = civiliansTarget(redCount());
  if (counts.redPlain < wanted) {
    warnings.push({
      code: 'CIVILIAN_SHARE_UNMET',
      key: 'redPlain',
      message: `Мирных жителей получилось ${counts.redPlain}, а по доле ${Math.round(share * 100)}% от красных нужно ${wanted}: мешают квоты или лимит Мирных`,
    });
  }
  roles.sort((a, b) => ROLE_IDS.indexOf(a) - ROLE_IDS.indexOf(b));
  return { ok: true, roles, counts, warnings: [...warnings, ...check.warnings] };
}

/** Какая доля красных мест отводится Мирным при данном числе игроков и конфиге. */
export function effectiveCiviliansShare(playerCount: number, minCiviliansShare: number | null): number {
  if (minCiviliansShare !== null) return minCiviliansShare;
  return playerCount >= CIVILIANS_SHARE_FROM_PLAYERS ? DEFAULT_CIVILIANS_SHARE : 0;
}
