/**
 * Настройки комнаты: значения по умолчанию, проверка и применение изменений.
 */
import { DEFAULT_RULES, ROLE_IDS, isRoleId } from '@mafia/engine';
import type { Quota, QuotaKey, RoleId, RoleSetting, Rules } from '@mafia/engine';
import type { DisplayMode, HostMode, RoomSettings, SettingsPatch, TimerSettings } from './messages';

export const LIMITS = {
  /** Максимальный размер входящего сообщения, символов. */
  messageChars: 16 * 1024,
  nameMax: 20,
  passwordMax: 64,
  chatMax: 300,
  tokenMax: 128,
  /** Максимум участников комнаты. */
  maxMembers: 20,
  /** Границы таймеров фаз, секунд. */
  timerMin: 10,
  timerMax: 3600,
  /** Максимум копий одной роли и значение квоты. */
  countMax: 20,
} as const;

export const HOST_MODES: readonly HostMode[] = ['player', 'narrator'];
export const DISPLAY_MODES: readonly DisplayMode[] = ['stealth', 'open', 'cinema'];
export const QUOTA_KEYS: readonly QuotaKey[] = [
  'red',
  'redInfo',
  'redDefense',
  'redActive',
  'redPlain',
  'black',
  'neutral',
];

const BOOLEAN_RULES = [
  'revealRoleOnDeath',
  'revealDeathCause',
  'commissionerSeesDonAsMafia',
  'commissionerSeesManiacAsMafia',
  'deadSeeAllRoles',
  'jesterWinEndsGame',
  'announceSaves',
  'doctorSelfHeal',
] as const satisfies readonly (keyof Rules)[];

const ENUM_RULES = {
  mistressMode: ['red', 'neutral'],
  votingMode: ['secret', 'revealAfter', 'open'],
} as const satisfies Partial<Record<keyof Rules, readonly string[]>>;

const TIMER_KEYS = ['night', 'day', 'decision'] as const satisfies readonly (keyof TimerSettings)[];

export function defaultRoomSettings(hostMode: HostMode = 'player'): RoomSettings {
  return {
    hostMode,
    display: 'stealth',
    timers: { night: null, day: null, decision: null },
    rules: { ...DEFAULT_RULES },
    composition: { roles: {}, quotas: {}, preset: null, minCiviliansShare: null },
  };
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LIMITS.countMax;
}

/** Проверить изменение настроек, пришедшее от клиента. Лишние поля отклоняются. */
export function checkSettingsPatch(input: unknown): Checked<SettingsPatch> {
  if (!isObject(input)) return fail('Настройки должны быть объектом');
  const patch: SettingsPatch = {};

  for (const key of Object.keys(input)) {
    if (!['hostMode', 'display', 'timers', 'rules', 'composition'].includes(key)) {
      return fail(`Неизвестная настройка: ${key}`);
    }
  }

  if (input.hostMode !== undefined) {
    if (!HOST_MODES.includes(input.hostMode as HostMode)) return fail('Неизвестный режим хоста');
    patch.hostMode = input.hostMode as HostMode;
  }
  if (input.display !== undefined) {
    if (!DISPLAY_MODES.includes(input.display as DisplayMode)) return fail('Неизвестный режим показа событий');
    patch.display = input.display as DisplayMode;
  }

  if (input.timers !== undefined) {
    if (!isObject(input.timers)) return fail('Таймеры должны быть объектом');
    const timers: Partial<TimerSettings> = {};
    for (const [key, value] of Object.entries(input.timers)) {
      if (!(TIMER_KEYS as readonly string[]).includes(key)) return fail(`Неизвестный таймер: ${key}`);
      const valid =
        value === null ||
        (typeof value === 'number' && Number.isInteger(value) && value >= LIMITS.timerMin && value <= LIMITS.timerMax);
      if (!valid) {
        return fail(`Таймер должен быть выключен или задан в секундах от ${LIMITS.timerMin} до ${LIMITS.timerMax}`);
      }
      timers[key as keyof TimerSettings] = value as number | null;
    }
    patch.timers = timers;
  }

  if (input.rules !== undefined) {
    if (!isObject(input.rules)) return fail('Правила должны быть объектом');
    const rules: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.rules)) {
      if ((BOOLEAN_RULES as readonly string[]).includes(key)) {
        if (typeof value !== 'boolean') return fail(`Правило ${key} должно быть включено или выключено`);
      } else if (key in ENUM_RULES) {
        const allowed = ENUM_RULES[key as keyof typeof ENUM_RULES] as readonly string[];
        if (typeof value !== 'string' || !allowed.includes(value)) return fail(`Недопустимое значение правила ${key}`);
      } else {
        return fail(`Неизвестное правило: ${key}`);
      }
      rules[key] = value;
    }
    patch.rules = rules as Partial<Rules>;
  }

  if (input.composition !== undefined) {
    if (!isObject(input.composition)) return fail('Состав должен быть объектом');
    const source = input.composition;
    const composition: NonNullable<SettingsPatch['composition']> = {};
    for (const key of Object.keys(source)) {
      if (!['roles', 'quotas', 'preset', 'minCiviliansShare'].includes(key)) {
        return fail(`Неизвестная настройка состава: ${key}`);
      }
    }

    if (source.roles !== undefined) {
      if (!isObject(source.roles)) return fail('Список ролей должен быть объектом');
      const roles: Partial<Record<RoleId, RoleSetting>> = {};
      for (const [role, value] of Object.entries(source.roles)) {
        if (!isRoleId(role)) return fail(`Неизвестная роль: ${role}`);
        if (!isObject(value)) return fail(`Настройка роли ${role} должна быть объектом`);
        const setting: RoleSetting = {};
        for (const [field, fieldValue] of Object.entries(value)) {
          if (field === 'enabled') {
            if (typeof fieldValue !== 'boolean') return fail(`Роль ${role}: «включена» должно быть да или нет`);
            setting.enabled = fieldValue;
          } else if (field === 'max') {
            if (fieldValue !== null && !isCount(fieldValue)) {
              return fail(`Роль ${role}: лимит копий должен быть целым числом от 0 до ${LIMITS.countMax}`);
            }
            setting.max = fieldValue;
          } else {
            return fail(`Роль ${role}: неизвестное поле ${field}`);
          }
        }
        roles[role] = setting;
      }
      composition.roles = roles;
    }

    if (source.quotas !== undefined) {
      if (!isObject(source.quotas)) return fail('Квоты должны быть объектом');
      const quotas: Partial<Record<QuotaKey, Quota>> = {};
      for (const [key, value] of Object.entries(source.quotas)) {
        if (!(QUOTA_KEYS as readonly string[]).includes(key)) return fail(`Неизвестная категория квоты: ${key}`);
        if (!isObject(value)) return fail(`Квота ${key} должна быть объектом`);
        const quota: Quota = {};
        for (const [field, fieldValue] of Object.entries(value)) {
          if (field !== 'min' && field !== 'max' && field !== 'exact') return fail(`Квота ${key}: неизвестное поле ${field}`);
          if (!isCount(fieldValue)) {
            return fail(`Квота ${key}: значение должно быть целым числом от 0 до ${LIMITS.countMax}`);
          }
          quota[field] = fieldValue;
        }
        quotas[key as QuotaKey] = quota;
      }
      composition.quotas = quotas;
    }

    if (source.preset !== undefined) {
      if (source.preset !== null) {
        if (!Array.isArray(source.preset) || source.preset.length > LIMITS.maxMembers) {
          return fail('Ручной состав должен быть списком ролей');
        }
        for (const role of source.preset) if (!isRoleId(role)) return fail(`Неизвестная роль: ${String(role)}`);
      }
      composition.preset = source.preset as RoleId[] | null;
    }

    if (source.minCiviliansShare !== undefined) {
      const share = source.minCiviliansShare;
      if (share !== null && !(typeof share === 'number' && share >= 0 && share <= 1)) {
        return fail('Доля Мирных жителей должна быть числом от 0 до 1');
      }
      composition.minCiviliansShare = share as number | null;
    }
    patch.composition = composition;
  }

  return { ok: true, value: patch };
}

/** Применить проверенное изменение. Исходные настройки не меняются. */
export function applySettingsPatch(settings: RoomSettings, patch: SettingsPatch): RoomSettings {
  return {
    hostMode: patch.hostMode ?? settings.hostMode,
    display: patch.display ?? settings.display,
    timers: { ...settings.timers, ...(patch.timers ?? {}) },
    rules: { ...settings.rules, ...(patch.rules ?? {}) },
    composition: {
      roles: patch.composition?.roles !== undefined ? { ...patch.composition.roles } : { ...settings.composition.roles },
      quotas:
        patch.composition?.quotas !== undefined ? { ...patch.composition.quotas } : { ...settings.composition.quotas },
      preset:
        patch.composition?.preset !== undefined
          ? patch.composition.preset && [...patch.composition.preset]
          : settings.composition.preset,
      minCiviliansShare:
        patch.composition?.minCiviliansShare !== undefined
          ? patch.composition.minCiviliansShare
          : settings.composition.minCiviliansShare,
    },
  };
}

/** Все роли каталога — для интерфейса настроек. */
export const ALL_ROLE_IDS: readonly RoleId[] = ROLE_IDS;
