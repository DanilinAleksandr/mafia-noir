/**
 * Каталог ролей. Роли описаны данными: команда, категория, ночные способности, пассивки, условие победы.
 * Логика разрешения способностей живёт в night.ts и опирается на эти данные.
 */
import type {
  AbilityDef,
  AbilityId,
  Category,
  NightStep,
  Passive,
  RoleDef,
  RoleId,
  Rules,
  Team,
  WinCondition,
} from './types';
import { ROLE_IDS } from './types';

function ability(id: AbilityId, step: NightStep, extra: Partial<AbilityDef> = {}): AbilityDef {
  return {
    id,
    step,
    targets: 1,
    self: false,
    uses: null,
    firstNightOnly: false,
    noRepeat: false,
    visit: true,
    filter: 'any',
    ...extra,
  };
}

interface RoleInit {
  name: string;
  summary: string;
  team: Team;
  category: Category;
  maxCopies?: number | null;
  abilities?: AbilityDef[];
  passives?: Passive[];
  win?: WinCondition;
  needs?: RoleId[];
}

function role(id: RoleId, init: RoleInit): RoleDef {
  return {
    id,
    name: init.name,
    summary: init.summary,
    team: init.team,
    category: init.category,
    maxCopies: init.maxCopies === undefined ? 1 : init.maxCopies,
    abilities: init.abilities ?? [],
    passives: init.passives ?? [],
    win: init.win ?? 'team',
    needs: init.needs ?? [],
  };
}

export const ROLES: Record<RoleId, RoleDef> = {
  // ── красные, информационные ──
  commissioner: role('commissioner', {
    name: 'Комиссар',
    summary: 'Каждую ночь проверяет игрока: мафия или не мафия.',
    team: 'red',
    category: 'redInfo',
    abilities: [ability('check', 'info')],
  }),
  detective: role('detective', {
    name: 'Следователь',
    summary: 'Один раз за игру узнаёт точную роль игрока.',
    team: 'red',
    category: 'redInfo',
    abilities: [ability('investigate', 'info', { uses: 1 })],
  }),
  patrol: role('patrol', {
    name: 'Патрульный',
    summary: 'Следит за игроком и видит, кто приходил к нему ночью.',
    team: 'red',
    category: 'redInfo',
    abilities: [ability('watch', 'info', { visit: false })],
  }),
  journalist: role('journalist', {
    name: 'Журналист',
    summary: 'Сравнивает двух игроков: в одной они команде или нет.',
    team: 'red',
    category: 'redInfo',
    abilities: [ability('compare', 'info', { targets: 2 })],
  }),
  hobo: role('hobo', {
    name: 'Бомж',
    summary: 'Ночует у игрока, видит его гостей и погибает вместе с ним.',
    team: 'red',
    category: 'redInfo',
    abilities: [ability('stay', 'info')],
  }),
  // ── красные, защитные ──
  doctor: role('doctor', {
    name: 'Доктор',
    summary: 'Лечит игрока от ночного нападения. Нельзя лечить одного и того же две ночи подряд.',
    team: 'red',
    category: 'redDefense',
    abilities: [ability('heal', 'protect', { self: true, noRepeat: true })],
  }),
  bodyguard: role('bodyguard', {
    name: 'Телохранитель',
    summary: 'Охраняет игрока и принимает нападение на себя.',
    team: 'red',
    category: 'redDefense',
    abilities: [ability('guard', 'protect')],
  }),
  priest: role('priest', {
    name: 'Священник',
    summary: 'Игрока, которого он выбрал ночью, нельзя казнить на следующий день.',
    team: 'red',
    category: 'redDefense',
    abilities: [ability('bless', 'protect', { self: true, noRepeat: true })],
  }),
  hero: role('hero', {
    name: 'Герой',
    summary: 'Переживает первое нападение.',
    team: 'red',
    category: 'redDefense',
    passives: ['armor'],
  }),
  witch: role('witch', {
    name: 'Ведьма',
    summary: 'Одно зелье спасения и одно зелье убийства на всю игру.',
    team: 'red',
    category: 'redDefense',
    abilities: [
      ability('potionHeal', 'protect', { self: true, uses: 1 }),
      ability('potionKill', 'attack', { uses: 1 }),
    ],
  }),
  // ── красные, активные ──
  hunter: role('hunter', {
    name: 'Охотник',
    summary: 'Погибая, может забрать с собой одного игрока.',
    team: 'red',
    category: 'redActive',
    passives: ['lastShot'],
  }),
  mayor: role('mayor', {
    name: 'Мэр',
    summary: 'Его голос на дневном голосовании считается за два.',
    team: 'red',
    category: 'redActive',
    passives: ['doubleVote'],
  }),
  judge: role('judge', {
    name: 'Судья',
    summary: 'Один раз за игру отменяет итог голосования.',
    team: 'red',
    category: 'redActive',
    passives: ['veto'],
  }),
  cupid: role('cupid', {
    name: 'Купидон',
    summary: 'В первую ночь связывает двух игроков: если погибнет один, погибнет и второй.',
    team: 'red',
    category: 'redActive',
    abilities: [ability('link', 'link', { targets: 2, self: true, uses: 1, firstNightOnly: true })],
  }),
  // ── красные, обычные ──
  civilian: role('civilian', {
    name: 'Мирный житель',
    summary: 'Способностей нет. Ищет мафию днём.',
    team: 'red',
    category: 'redPlain',
    maxCopies: null,
  }),
  // ── чёрные ──
  mafia: role('mafia', {
    name: 'Мафия',
    summary: 'Ночью вместе с командой выбирает жертву.',
    team: 'black',
    category: 'black',
    maxCopies: null,
  }),
  don: role('don', {
    name: 'Дон',
    summary: 'Глава мафии: при равенстве голосов мафии решает его голос.',
    team: 'black',
    category: 'black',
    passives: ['donTiebreak'],
  }),
  lawyer: role('lawyer', {
    name: 'Адвокат',
    summary: 'Прикрывает мафиози: проверка Комиссара этой ночью покажет «не мафия».',
    team: 'black',
    category: 'black',
    abilities: [ability('cover', 'effect', { self: true, filter: 'blackOnly' })],
    needs: ['commissioner'],
  }),
  blackmailer: role('blackmailer', {
    name: 'Шантажист',
    summary: 'Запрещает игроку говорить на следующем обсуждении.',
    team: 'black',
    category: 'black',
    abilities: [ability('silence', 'effect', { noRepeat: true })],
  }),
  consigliere: role('consigliere', {
    name: 'Консильери',
    summary: 'Каждую ночь узнаёт точную роль игрока.',
    team: 'black',
    category: 'black',
    abilities: [ability('scout', 'info', { filter: 'notBlack' })],
  }),
  // ── нейтральные ──
  maniac: role('maniac', {
    name: 'Маньяк',
    summary: 'Убивает каждую ночь. Побеждает, оставшись один или вдвоём, когда мафии нет.',
    team: 'neutral',
    category: 'neutral',
    abilities: [ability('kill', 'attack')],
    win: 'maniac',
  }),
  mistress: role('mistress', {
    name: 'Любовница',
    summary: 'Блокирует способность игрока на ночь. Нельзя блокировать одного и того же две ночи подряд.',
    team: 'neutral',
    category: 'neutral',
    abilities: [ability('block', 'block', { noRepeat: true })],
    win: 'survive',
  }),
  jester: role('jester', {
    name: 'Шут',
    summary: 'Побеждает, если его казнят на дневном голосовании.',
    team: 'neutral',
    category: 'neutral',
    win: 'executed',
  }),
  survivor: role('survivor', {
    name: 'Выживший',
    summary: 'Побеждает, если жив в конце игры.',
    team: 'neutral',
    category: 'neutral',
    win: 'survive',
  }),
  bomber: role('bomber', {
    name: 'Подрывник',
    summary: 'Если его казнят, забирает одного из голосовавших против и побеждает.',
    team: 'neutral',
    category: 'neutral',
    passives: ['blast'],
    win: 'executed',
  }),
};

/** Все роли в порядке каталога. */
export const ROLE_LIST: RoleDef[] = ROLE_IDS.map((id) => ROLES[id]);

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value);
}

export function hasPassive(roleId: RoleId, passive: Passive): boolean {
  return ROLES[roleId].passives.includes(passive);
}

/** Команда роли с учётом правил (Любовница бывает красной). */
export function teamOf(roleId: RoleId, rules: Rules): Team {
  if (roleId === 'mistress' && rules.mistressMode === 'red') return 'red';
  return ROLES[roleId].team;
}

/** Категория роли для квот с учётом правил. */
export function categoryOf(roleId: RoleId, rules: Rules): Category {
  if (roleId === 'mistress' && rules.mistressMode === 'red') return 'redActive';
  return ROLES[roleId].category;
}

/** Условие победы роли с учётом правил. */
export function winOf(roleId: RoleId, rules: Rules): WinCondition {
  if (roleId === 'mistress' && rules.mistressMode === 'red') return 'team';
  return ROLES[roleId].win;
}

export function findAbility(roleId: RoleId, abilityId: AbilityId): AbilityDef | undefined {
  return ROLES[roleId].abilities.find((a) => a.id === abilityId);
}
