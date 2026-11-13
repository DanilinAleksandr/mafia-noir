/**
 * Наборы ролей: готовые (в коде клиента) и сохранённые хостом (localStorage этого устройства).
 */
import { ROLE_IDS } from '@mafia/engine';
import type { CompositionConfig, RoleId, RoleSetting, Rules } from '@mafia/engine';
import type { DisplayMode, RoomSettings, SettingsPatch, TimerSettings } from '@mafia/protocol';

export interface RoleSet {
  name: string;
  description?: string;
  display?: DisplayMode;
  timers?: TimerSettings;
  rules?: Partial<Rules>;
  composition: Pick<CompositionConfig, 'roles' | 'quotas' | 'minCiviliansShare'> & { preset?: RoleId[] | null };
}

function only(roles: RoleId[]): Partial<Record<RoleId, RoleSetting>> {
  const out: Partial<Record<RoleId, RoleSetting>> = {};
  for (const id of ROLE_IDS) if (!roles.includes(id)) out[id] = { enabled: false };
  return out;
}

export const BUILT_IN_SETS: RoleSet[] = [
  {
    name: 'Классика',
    description: 'Мафия, Дон, Комиссар, Доктор и мирные. Для первой игры.',
    composition: { roles: only(['mafia', 'don', 'commissioner', 'doctor', 'civilian']), quotas: {}, minCiviliansShare: null },
  },
  {
    name: 'Городская',
    description: 'Больше ролей у города и у мафии, один-два нейтрала.',
    composition: {
      roles: only([
        'commissioner', 'detective', 'doctor', 'bodyguard', 'priest', 'hunter', 'mayor', 'civilian',
        'mafia', 'don', 'lawyer', 'blackmailer', 'maniac', 'jester',
      ]),
      quotas: {},
      minCiviliansShare: null,
    },
  },
  {
    name: 'Интриги',
    description: 'Любовница, Купидон, Судья и Консильери — для опытных.',
    composition: {
      roles: only([
        'commissioner', 'patrol', 'journalist', 'hobo', 'doctor', 'witch', 'judge', 'cupid', 'civilian',
        'mafia', 'don', 'consigliere', 'blackmailer', 'mistress', 'survivor', 'bomber',
      ]),
      quotas: {},
      minCiviliansShare: null,
    },
  },
  {
    name: 'Хаос',
    description: 'Все 25 ролей. Никто ни в чём не уверен.',
    composition: { roles: {}, quotas: {}, minCiviliansShare: 0.15 },
  },
];

const SAVED_KEY = 'mafia.sets';

export function loadSavedSets(): RoleSet[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed.filter((s) => s && typeof s.name === 'string' && s.composition) as RoleSet[]) : [];
  } catch {
    return [];
  }
}

export function saveSets(sets: RoleSet[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(sets));
  } catch {
    // нет места или приватный режим
  }
}

/** Снимок текущих настроек как набор. */
export function setFromSettings(name: string, settings: RoomSettings): RoleSet {
  return {
    name,
    display: settings.display,
    timers: { ...settings.timers },
    rules: { ...settings.rules },
    composition: {
      roles: { ...settings.composition.roles },
      quotas: { ...settings.composition.quotas },
      minCiviliansShare: settings.composition.minCiviliansShare,
      preset: settings.composition.preset ? [...settings.composition.preset] : null,
    },
  };
}

/** Изменение настроек, которое применяет набор. */
export function patchFromSet(set: RoleSet): SettingsPatch {
  const patch: SettingsPatch = {
    composition: {
      roles: set.composition.roles,
      quotas: set.composition.quotas,
      minCiviliansShare: set.composition.minCiviliansShare,
      preset: set.composition.preset ?? null,
    },
  };
  if (set.display) patch.display = set.display;
  if (set.timers) patch.timers = set.timers;
  if (set.rules) patch.rules = set.rules;
  return patch;
}
